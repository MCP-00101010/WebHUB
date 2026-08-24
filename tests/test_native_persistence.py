import importlib.util
import base64
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch


HOST_PATH = Path(__file__).parents[1] / 'extension' / 'native' / 'morpheus_host.py'
TEST_TEMP_ROOT = Path(__file__).parents[1] / '.test-tmp'
TEST_TEMP_ROOT.mkdir(exist_ok=True)
SPEC = importlib.util.spec_from_file_location('morpheus_host', HOST_PATH)
HOST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOST)


class NativePersistenceTests(unittest.TestCase):
    def test_conditional_write_accepts_metadata_only_change(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            path = Path(directory) / 'hub.json'
            path.write_text('{"value":1}', encoding='utf-8')
            baseline = HOST.get_file_info(path, include_hash=True)
            next_mtime = (path.stat().st_mtime_ns + 2_000_000_000) / 1_000_000_000
            os.utime(path, (next_mtime, next_mtime))

            result = HOST.write_file_if_unchanged(
                path,
                '{"value":2}',
                expected_version=baseline['version'],
                expected_hash=baseline['contentHash']
            )

            self.assertFalse(result['conflict'])
            self.assertEqual(path.read_text(encoding='utf-8'), '{"value":2}')

    def test_conditional_write_rejects_changed_content(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            path = Path(directory) / 'hub.json'
            path.write_text('{"value":1}', encoding='utf-8')
            baseline = HOST.get_file_info(path, include_hash=True)
            HOST.atomic_write_text(path, '{"external":true}')

            result = HOST.write_file_if_unchanged(
                path,
                '{"value":2}',
                expected_version=baseline['version'],
                expected_hash=baseline['contentHash']
            )

            self.assertTrue(result['conflict'])
            self.assertEqual(path.read_text(encoding='utf-8'), '{"external":true}')

    def test_identical_content_is_already_current(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            path = Path(directory) / 'hub.json'
            path.write_text('{"value":1}', encoding='utf-8')
            baseline = HOST.get_file_info(path, include_hash=True)
            HOST.atomic_write_text(path, '{"value":200}')

            result = HOST.write_file_if_unchanged(
                path,
                '{"value":200}',
                expected_version=baseline['version'],
                expected_hash=baseline['contentHash']
            )

            self.assertFalse(result['conflict'])
            self.assertTrue(result['alreadyCurrent'])

    def test_concurrent_writers_cannot_both_replace_same_baseline(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            path = Path(directory) / 'hub.json'
            path.write_text('{"value":0}', encoding='utf-8')
            baseline = HOST.get_file_info(path, include_hash=True)

            def write(value):
                return HOST.write_file_if_unchanged(
                    path,
                    f'{{"value":{value}}}',
                    expected_version=baseline['version'],
                    expected_hash=baseline['contentHash']
                )

            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(write, (1, 2)))

            self.assertEqual(sum(result['conflict'] is False for result in results), 1)
            self.assertEqual(sum(result['conflict'] is True for result in results), 1)
            self.assertIn(path.read_text(encoding='utf-8'), ('{"value":1}', '{"value":2}'))

    def test_chunk_read_rejects_a_different_file_version(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            path = Path(directory) / 'hub.json'
            path.write_text('x' * 2048, encoding='utf-8')
            first = HOST.read_file_chunk(path, 0, 256)
            HOST.atomic_write_text(path, 'y' * 2048)
            with self.assertRaisesRegex(RuntimeError, 'changed during chunked read'):
                HOST.read_file_chunk(path, 256, 256, first['readVersion'])

    def test_theme_paths_are_confined_to_the_theme_directory(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            target = HOST.resolve_theme_path(directory, 'safe-theme')
            self.assertEqual(Path(target).name, 'safe-theme.json')
            with self.assertRaises(ValueError):
                HOST.resolve_theme_path(directory, '../escape')

    def test_database_backups_are_coalesced_within_one_minute(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            path = Path(directory) / 'hub.json'
            path.write_text('{"value":1}', encoding='utf-8')
            first = HOST.backup_database_file(path)
            second = HOST.backup_database_file(path)
            self.assertEqual(first, second)
            self.assertEqual(len(list((Path(directory) / 'backups').glob('*.json'))), 1)

    def test_backup_timeline_reports_integrity_and_summary(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            path = Path(directory) / 'hub.json'
            path.write_text('{"schemaVersion":2,"boards":[{"tabs":[{}]}],"sets":[],"tags":[],"settings":{}}', encoding='utf-8')
            first = HOST.backup_database_file(path, force=True)
            second = HOST.backup_database_file(path, force=True)
            self.assertNotEqual(first, second)
            backups = HOST.list_database_backups(path)
            self.assertEqual(len(backups), 2)
            self.assertEqual(backups[0]['integrity'], 'ok')
            self.assertEqual(backups[0]['summary']['schemaVersion'], 2)
            self.assertEqual(backups[0]['summary']['tabs'], 1)

    def test_backup_paths_are_confined_to_configured_backup_directory(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            path = Path(directory) / 'hub.json'
            path.write_text('{}', encoding='utf-8')
            backup = Path(HOST.backup_database_file(path, force=True))
            resolved = HOST.resolve_database_backup_path(path, backup.name)
            self.assertEqual(Path(resolved), backup)
            with self.assertRaises(ValueError):
                HOST.resolve_database_backup_path(path, '../outside.json')

    def test_corrupt_backup_is_visible_but_not_marked_safe(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            path = Path(directory) / 'hub.json'
            path.write_text('{}', encoding='utf-8')
            backup = Path(HOST.backup_database_file(path, force=True))
            backup.write_text('{broken', encoding='utf-8')
            listed = HOST.list_database_backups(path)
            self.assertEqual(listed[0]['integrity'], 'invalid-json')

    def test_backup_chunk_read_detects_mid_read_change(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            path = Path(directory) / 'hub.json'
            path.write_text('{"value":"' + ('x' * 2048) + '"}', encoding='utf-8')
            backup = Path(HOST.backup_database_file(path, force=True))
            first = HOST.read_database_backup_chunk(path, backup.name, 0, 256)
            HOST.atomic_write_text(backup, '{"changed":true}')
            with self.assertRaisesRegex(RuntimeError, 'changed during chunked read'):
                HOST.read_database_backup_chunk(path, backup.name, 256, 256, first['readVersion'])

    def test_system_metrics_return_only_requested_aggregate_fields(self):
        metrics = HOST.collect_system_metrics(['memory', 'uptime', 'unknown', 'memory'])
        self.assertIn('sampledAt', metrics)
        self.assertIn('memory', metrics)
        self.assertIn('uptime', metrics)
        self.assertNotIn('cpu', metrics)
        self.assertNotIn('unknown', metrics)
        if metrics['memory'] is not None:
            self.assertGreater(metrics['memory']['totalBytes'], 0)

    def test_approved_directory_handles_do_not_expose_paths_in_portable_config(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            config_path = Path(directory) / 'native-config.json'
            repository = Path(directory) / 'repo'
            repository.mkdir()
            original = HOST.CONFIG_PATH
            HOST.CONFIG_PATH = str(config_path)
            try:
                approved = HOST.approve_directory('git', selected_path=str(repository))
                self.assertRegex(approved['handle'], r'^dir_[A-Za-z0-9_-]+$')
                resolved, entry = HOST.resolve_approved_directory(approved['handle'], 'git')
                self.assertEqual(Path(resolved), repository)
                self.assertEqual(entry['purpose'], 'git')
                HOST.save_config({'databasePath': str(Path(directory) / 'hub.json')})
                self.assertIn(approved['handle'], HOST.load_config()['approvedDirectories'])
                with self.assertRaisesRegex(ValueError, 'does not grant'):
                    HOST.resolve_approved_directory(approved['handle'], 'recent-files')
            finally:
                HOST.CONFIG_PATH = original

    def test_git_workspace_parses_branch_changes_and_remote_safely(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            config_path = Path(directory) / 'native-config.json'
            repository = Path(directory) / 'repo'
            repository.mkdir()
            original = HOST.CONFIG_PATH
            HOST.CONFIG_PATH = str(config_path)
            try:
                approved = HOST.approve_directory('git', selected_path=str(repository))
                outputs = iter([
                    '# branch.head feature\n# branch.ab +2 -1\n1 MM N... 100644 100644 100644 a b file.txt\n? new.txt\n',
                    'abcdef\x1fabc123\x1f1700000000\x1fUseful commit\n',
                    'git@github.com:example/project.git\n'
                ])
                with patch.object(HOST, '_run_git', side_effect=lambda *args, **kwargs: next(outputs)):
                    result = HOST.git_workspace_status(approved['handle'])
                self.assertEqual(result['branch'], 'feature')
                self.assertEqual((result['ahead'], result['behind']), (2, 1))
                self.assertEqual((result['staged'], result['unstaged'], result['untracked']), (1, 2, 1))
                self.assertEqual(result['remoteUrl'], 'https://github.com/example/project')
            finally:
                HOST.CONFIG_PATH = original

    def test_windows_terminal_launch_uses_approved_directory_without_shell_text(self):
        approved_path = r'F:\Projects\Repository & Notes'
        terminal_path = r'C:\Users\tester\AppData\Local\Microsoft\WindowsApps\wt.exe'
        with patch.object(HOST, 'resolve_approved_directory', return_value=(approved_path, {})), \
                patch.object(HOST.sys, 'platform', 'win32'), \
                patch.object(HOST.shutil, 'which', side_effect=lambda name: terminal_path if name == 'wt.exe' else None), \
                patch.object(HOST.subprocess, 'Popen') as popen:
            self.assertTrue(HOST.open_approved_directory('dir_abcdefghijklmnop', 'git', 'terminal'))

        popen.assert_called_once_with(
            [terminal_path, '-d', approved_path], cwd=approved_path, close_fds=True
        )

    def test_windows_terminal_launch_falls_back_to_visible_powershell(self):
        approved_path = r'F:\Projects\Repository'
        powershell_path = r'C:\Program Files\PowerShell\7\pwsh.exe'
        with patch.object(HOST.sys, 'platform', 'win32'), \
                patch.object(HOST.shutil, 'which', side_effect=lambda name: powershell_path if name == 'pwsh.exe' else None), \
                patch.object(HOST.subprocess, 'Popen') as popen:
            HOST._launch_terminal(approved_path)

        popen.assert_called_once_with(
            [powershell_path, '-NoExit', '-NoLogo'], cwd=approved_path, close_fds=True,
            creationflags=getattr(HOST.subprocess, 'CREATE_NEW_CONSOLE', 0)
        )

    def test_recent_files_are_bounded_filtered_and_path_relative(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            config_path = Path(directory) / 'native-config.json'
            root = Path(directory) / 'downloads'
            nested = root / 'nested'
            nested.mkdir(parents=True)
            (root / 'recent.pdf').write_text('pdf', encoding='utf-8')
            (root / 'ignored.txt').write_text('txt', encoding='utf-8')
            (nested / 'nested.pdf').write_text('nested', encoding='utf-8')
            original = HOST.CONFIG_PATH
            HOST.CONFIG_PATH = str(config_path)
            try:
                approved = HOST.approve_directory('recent-files', selected_path=str(root))
                result = HOST.list_recent_files(approved['handle'], ['pdf'], 24, 10, recursive=True)
                self.assertEqual({item['relativePath'] for item in result['files']}, {'recent.pdf', 'nested/nested.pdf'})
                self.assertTrue(all('path' not in item for item in result['files']))
                with self.assertRaisesRegex(ValueError, 'escapes'):
                    HOST._approved_child_path(approved['handle'], 'recent-files', '../outside.txt')
            finally:
                HOST.CONFIG_PATH = original

    def test_application_approval_keeps_paths_native_and_rebinds_by_key(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            config_path = Path(directory) / 'native-config.json'
            executable = Path(directory) / 'Useful App.exe'
            executable.write_bytes(b'MZ')
            replacement = Path(directory) / 'Useful App 2.exe'
            replacement.write_bytes(b'MZ')
            original = HOST.CONFIG_PATH
            HOST.CONFIG_PATH = str(config_path)
            try:
                with patch.object(HOST.sys, 'platform', 'win32'), \
                        patch.object(HOST, '_application_icon_data_url', return_value='data:image/png;base64,aWNvbg=='):
                    approved = HOST.approve_application(selected_path=str(executable))
                    self.assertRegex(approved['appKey'], r'^app_[A-Za-z0-9_-]+$')
                    self.assertNotIn('path', approved)
                    self.assertEqual(approved['state'], 'ready')
                    self.assertEqual(HOST.application_status(approved['appKey'])['state'], 'ready')
                    rebound = HOST.approve_application(approved['appKey'], selected_path=str(replacement))
                    self.assertEqual(rebound['appKey'], approved['appKey'])
                    resolved, _ = HOST.resolve_approved_application(approved['appKey'])
                    self.assertEqual(Path(resolved), replacement)
                stored = json.loads(config_path.read_text(encoding='utf-8'))
                self.assertIn(str(replacement), stored['approvedApplications'][approved['appKey']]['path'])
            finally:
                HOST.CONFIG_PATH = original

    def test_application_launch_uses_only_the_approved_path(self):
        approved_path = r'F:\Apps\Useful & Safe.exe'
        with patch.object(HOST, 'resolve_approved_application', return_value=(approved_path, {'kind': 'executable'})), \
                patch.object(HOST.sys, 'platform', 'win32'), \
                patch.object(HOST.subprocess, 'Popen') as popen:
            self.assertTrue(HOST.launch_approved_application('app_abcdefghijklmnop'))
        popen.assert_called_once_with([approved_path], cwd=r'F:\Apps', close_fds=True)

    def test_dropped_protocol_link_is_stored_without_a_page_visible_path(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            config_path = Path(directory) / 'native-config.json'
            original = HOST.CONFIG_PATH
            HOST.CONFIG_PATH = str(config_path)
            try:
                with patch.object(HOST, '_application_link_icon_data_url', return_value=''):
                    approved = HOST.approve_application_link(
                        title="Baldur's Gate 3", target_uri='steam://rungameid/1086940'
                    )
                self.assertEqual(approved['kind'], 'protocol-link')
                self.assertNotIn('path', approved)
                stored = json.loads(config_path.read_text(encoding='utf-8'))['approvedApplications'][approved['appKey']]
                self.assertNotIn('path', stored)
                self.assertEqual(stored['targetUri'], 'steam://rungameid/1086940')
                with patch.object(HOST.sys, 'platform', 'win32'), \
                        patch.object(HOST.subprocess, 'Popen') as popen:
                    self.assertTrue(HOST.launch_approved_application(approved['appKey']))
                popen.assert_called_once_with(
                    ['explorer.exe', 'steam://rungameid/1086940'], close_fds=True,
                    creationflags=getattr(HOST.subprocess, 'CREATE_NO_WINDOW', 0)
                )
            finally:
                HOST.CONFIG_PATH = original

    def test_steam_protocol_link_accepts_only_a_steam_icon_cache_hint(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            config_path = Path(directory) / 'native-config.json'
            icon_dir = Path(directory) / 'steam' / 'games'
            icon_dir.mkdir(parents=True)
            icon_path = icon_dir / 'bg3.ico'
            icon_path.write_bytes(b'icon')
            original = HOST.CONFIG_PATH
            HOST.CONFIG_PATH = str(config_path)
            try:
                with patch.object(HOST.sys, 'platform', 'win32'), \
                        patch.object(HOST, '_application_icon_data_url', return_value='data:image/png;base64,aWNvbg=='), \
                        patch.object(HOST, '_steam_cached_app_icon_data_url', return_value=''), \
                        patch.object(HOST, '_steam_store_art_data_url', return_value=''):
                    approved = HOST.approve_application_link(
                        title="Baldur's Gate 3", target_uri='steam://rungameid/1086940', icon_hint=str(icon_path)
                    )
                    rejected_hint = HOST._application_link_icon_data_url(
                        'steam://rungameid/1086940', str(Path(directory) / 'private.ico')
                    )
                self.assertEqual(approved['iconDataUrl'], 'data:image/png;base64,aWNvbg==')
                self.assertEqual(rejected_hint, '')
                stored = json.loads(config_path.read_text(encoding='utf-8'))['approvedApplications'][approved['appKey']]
                self.assertNotIn('iconHint', stored)
                self.assertNotIn('iconSourcePath', stored)
            finally:
                HOST.CONFIG_PATH = original

    def test_steam_protocol_link_uses_the_bounded_local_app_cache_icon(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            cache_dir = Path(directory) / 'librarycache'
            app_dir = cache_dir / '977400'
            app_dir.mkdir(parents=True)
            image = b'\xff\xd8\xff' + b'cell-icon'
            (app_dir / '130a3091d6e6ae68e7204b21bfa2b4fec02c3d8d.jpg').write_bytes(image)
            with patch.object(HOST.sys, 'platform', 'win32'), \
                    patch.object(HOST, '_steam_library_cache_dir', return_value=str(cache_dir)), \
                    patch.object(HOST, '_steam_store_art_data_url') as store_art:
                result = HOST._application_link_icon_data_url('steam://rungameid/977400')
            self.assertEqual(result, 'data:image/jpeg;base64,' + base64.b64encode(image).decode('ascii'))
            store_art.assert_not_called()

    def test_steam_protocol_link_uses_official_store_art_when_local_cache_is_empty(self):
        expected = 'data:image/jpeg;base64,c3RlYW0='
        with patch.object(HOST.sys, 'platform', 'win32'), \
                patch.object(HOST, '_steam_cached_app_icon_data_url', return_value=''), \
                patch.object(HOST, '_download_favicon_candidate', return_value={'dataUrl': expected}) as download:
            result = HOST._application_link_icon_data_url('steam://rungameid/977400')
        self.assertEqual(result, expected)
        self.assertEqual(
            download.call_args.args[0],
            'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/977400/library_600x900.jpg'
        )

    def test_application_status_backfills_a_missing_protocol_link_icon(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            config_path = Path(directory) / 'native-config.json'
            app_key = 'app_abcdefghijklmnop'
            original = HOST.CONFIG_PATH
            HOST.CONFIG_PATH = str(config_path)
            try:
                HOST.save_config({'approvedApplications': {app_key: {
                    'targetUri': 'steam://rungameid/977400',
                    'kind': 'protocol-link',
                    'label': 'Cell to Singularity',
                    'iconDataUrl': ''
                }}})
                with patch.object(HOST, '_application_link_icon_data_url', return_value='data:image/jpeg;base64,Y2VsbA=='):
                    status = HOST.application_status(app_key)
                self.assertEqual(status['iconDataUrl'], 'data:image/jpeg;base64,Y2VsbA==')
                stored = json.loads(config_path.read_text(encoding='utf-8'))
                self.assertEqual(
                    stored['approvedApplications'][app_key]['iconDataUrl'],
                    'data:image/jpeg;base64,Y2VsbA=='
                )
            finally:
                HOST.CONFIG_PATH = original

    def test_windows_icon_extraction_passes_the_path_over_stdin(self):
        encoded = base64.b64encode(b'\x89PNG\r\n\x1a\nicon').decode('ascii')
        completed = type('Completed', (), {'stdout': encoded})()
        path = r'F:\Apps\Useful & Safe.exe'
        with patch.object(HOST.sys, 'platform', 'win32'), \
                patch.object(HOST.subprocess, 'run', return_value=completed) as run:
            result = HOST._application_icon_data_url(path)
        self.assertEqual(result, f'data:image/png;base64,{encoded}')
        self.assertNotIn(path, run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs['input'], path)

    def test_dropped_protocol_link_rejects_web_and_arbitrary_schemes(self):
        for target in ('https://example.com/', 'file:///C:/Windows/System32/cmd.exe', 'javascript:alert(1)'):
            with self.subTest(target=target):
                with self.assertRaisesRegex(ValueError, 'approved game and application protocol'):
                    HOST.approve_application_link(title='Unsafe', target_uri=target)

    def test_windows_game_uri_shortcut_can_be_approved(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            config_path = Path(directory) / 'native-config.json'
            shortcut = Path(directory) / "Baldur's Gate 3.url"
            shortcut.write_text('[InternetShortcut]\nURL=steam://rungameid/1086940\n', encoding='utf-8')
            original = HOST.CONFIG_PATH
            HOST.CONFIG_PATH = str(config_path)
            try:
                with patch.object(HOST.sys, 'platform', 'win32'), \
                        patch.object(HOST, '_application_icon_data_url', return_value=''):
                    approved = HOST.approve_application(selected_path=str(shortcut))
                    self.assertEqual(approved['kind'], 'uri-shortcut')
                    self.assertNotIn('path', approved)
                    self.assertEqual(HOST.application_status(approved['appKey'])['state'], 'ready')
            finally:
                HOST.CONFIG_PATH = original

    def test_windows_web_url_shortcut_is_not_an_application(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            shortcut = Path(directory) / 'Website.url'
            shortcut.write_text('[InternetShortcut]\nURL=https://example.com/\n', encoding='utf-8')
            with patch.object(HOST.sys, 'platform', 'win32'):
                with self.assertRaisesRegex(ValueError, 'approved game and application protocol'):
                    HOST._application_kind(str(shortcut))

    def test_windows_uri_shortcut_rejects_conflicting_targets(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            shortcut = Path(directory) / 'Conflicting.url'
            shortcut.write_text(
                '[InternetShortcut]\nURL=steam://rungameid/1086940\nURL=https://example.com/\n',
                encoding='utf-8'
            )
            with patch.object(HOST.sys, 'platform', 'win32'):
                with self.assertRaisesRegex(ValueError, 'one application target'):
                    HOST._application_kind(str(shortcut))

    def test_application_status_is_unbound_without_native_mapping(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            original = HOST.CONFIG_PATH
            HOST.CONFIG_PATH = str(Path(directory) / 'native-config.json')
            try:
                status = HOST.application_status('app_abcdefghijklmnop')
                self.assertEqual(status['state'], 'unbound')
                self.assertNotIn('path', status)
            finally:
                HOST.CONFIG_PATH = original

    def test_windows_application_picker_passes_titles_as_data(self):
        hostile_title = "Select Bob's app'; Write-Output injected; #"
        completed = type('Completed', (), {'stdout': r'C:\Apps\Editor.exe'})()
        with patch.object(HOST.sys, 'platform', 'win32'), \
                patch.dict(HOST.sys.modules, {'tkinter': None}), \
                patch.object(HOST.subprocess, 'run', return_value=completed) as run:
            selected = HOST.open_file_picker('application', hostile_title)
        arguments = run.call_args.args[0]
        self.assertEqual(selected, r'C:\Apps\Editor.exe')
        self.assertNotIn(hostile_title, arguments[4])
        self.assertEqual(arguments[-2], hostile_title)

    def test_emugui_status_loads_configured_service_without_exposing_paths(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            root = Path(directory) / 'EmuGUI'
            root.mkdir()
            (root / 'server.py').write_text(
                "def dispatch_emugui_read(method):\n"
                "    assert method == 'STATUS'\n"
                "    return {\n"
                "        'serviceVersion': 1,\n"
                "        'active': {'id': 'spectrum', 'name': 'ZX Spectrum', 'root': 'C:/private'},\n"
                "        'collections': [{}, {}],\n"
                "        'emulators': [{}],\n"
                "        'profiles': [{}, {}, {}]\n"
                "    }\n",
                encoding='utf-8'
            )
            config_path = Path(directory) / 'native-config.json'
            original_path = HOST.CONFIG_PATH
            original_module = HOST.EMUGUI_MODULE
            original_module_path = HOST.EMUGUI_MODULE_PATH
            HOST.CONFIG_PATH = str(config_path)
            HOST.EMUGUI_MODULE = None
            HOST.EMUGUI_MODULE_PATH = ''
            try:
                HOST.save_config({'databasePath': '', 'emuguiRoot': str(root)})
                status = HOST.emugui_service_status()
                stored = HOST.load_config()
                self.assertEqual(status['activeCollection'], {'id': 'spectrum', 'name': 'ZX Spectrum'})
                self.assertEqual(status['collectionCount'], 2)
                self.assertEqual(status['emulatorCount'], 1)
                self.assertEqual(status['profileCount'], 3)
                self.assertNotIn('root', json.dumps(status).lower())
                self.assertEqual(stored['emuguiRoot'], str(root.resolve()))
            finally:
                HOST.CONFIG_PATH = original_path
                HOST.EMUGUI_MODULE = original_module
                HOST.EMUGUI_MODULE_PATH = original_module_path

    def test_emugui_status_requires_an_explicit_configuration(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            original = HOST.CONFIG_PATH
            HOST.CONFIG_PATH = str(Path(directory) / 'native-config.json')
            try:
                with self.assertRaisesRegex(RuntimeError, 'not configured'):
                    HOST.emugui_service_status()
            finally:
                HOST.CONFIG_PATH = original

    def test_emugui_game_binding_is_opaque_reused_and_launchable(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            root = Path(directory)
            image = root / 'cover.png'
            image.write_bytes(b'\x89PNG\r\n\x1a\nsmall-cover')
            (root / 'Jetpac.tap').write_bytes(b'game')
            launches = []

            class FakeEmuGui:
                COLLECTION = root

                @staticmethod
                def dispatch_emugui_read(method, params=None):
                    if method == 'STATUS':
                        return {
                            'active': {'id': 'spectrum', 'name': 'ZX Spectrum'},
                            'emulators': [{'id': 'eightyone', 'name': 'EightyOne', 'available': True}],
                            'profiles': [{'id': 'profile-48k', 'name': 'Spectrum 48K', 'emulator_id': 'eightyone'}]
                        }
                    if method == 'GET_GAME' and params.get('gameId') == 'jetpac':
                        return {'game': {
                            'id': 'jetpac', 'title': 'Jetpac', 'default_emulator': 'eightyone',
                            'loading_screen': 'cover.png', 'path': str(root / 'Jetpac.tap')
                        }}
                    raise ValueError('Unknown game')

                @staticmethod
                def launch_game(game_id, emulator_id, profile_id=''):
                    launches.append((game_id, emulator_id, profile_id))
                    return {'ok': True}

            config_path = root / 'native-config.json'
            original = HOST.CONFIG_PATH
            HOST.CONFIG_PATH = str(config_path)
            try:
                with patch.object(HOST, '_load_emugui_module', return_value=FakeEmuGui):
                    first = HOST.create_emugui_game_binding('jetpac', 'eightyone', 'profile-48k')
                    second = HOST.create_emugui_game_binding('jetpac', 'eightyone', 'profile-48k')
                    stored = HOST.load_config()['approvedGames'][first['gameKey']]
                    self.assertEqual(first['gameKey'], second['gameKey'])
                    self.assertEqual(first['state'], 'ready')
                    self.assertEqual(first['systemId'], 'zx-spectrum')
                    self.assertEqual(first['systemName'], 'ZX Spectrum')
                    self.assertEqual(first['tags'], ['Games', 'ZX Spectrum'])
                    self.assertEqual(first['emulatorName'], 'EightyOne')
                    self.assertEqual(first['profileName'], 'Spectrum 48K')
                    self.assertEqual(stored['systemId'], 'zx-spectrum')
                    self.assertEqual(stored['emulatorName'], 'EightyOne')
                    self.assertEqual(stored['profileName'], 'Spectrum 48K')
                    self.assertTrue(first['thumbnailCache'].startswith('data:image/png;base64,'))
                    self.assertNotIn('path', json.dumps(first).lower())
                    self.assertNotIn('path', json.dumps(stored).lower())
                    self.assertTrue(HOST.launch_emugui_game(first['gameKey']))
                    self.assertEqual(launches, [('jetpac', 'eightyone', 'profile-48k')])
                    self.assertEqual(HOST.emugui_game_status(first['gameKey'])['state'], 'ready')
                    self.assertTrue(HOST.emugui_game_status(first['gameKey'], True)['thumbnailCache'].startswith('data:image/png;base64,'))
                    link = HOST.emugui_game_link(first['gameKey'], rebind=True)
                    self.assertIn('game=jetpac', link)
                    self.assertIn(f'hubRebind={first["gameKey"]}', link)
                    self.assertNotIn(str(root), link)
                    rebound = HOST.rebind_emugui_game(first['gameKey'], 'jetpac', 'eightyone', 'profile-48k')
                    self.assertEqual(rebound['gameKey'], first['gameKey'])
                    with patch.object(HOST.subprocess, 'Popen') as opened, patch.object(HOST.sys, 'platform', 'win32'):
                        self.assertTrue(HOST.reveal_emugui_game(first['gameKey']))
                        self.assertEqual(opened.call_args.args[0][:2], ['explorer.exe', '/select,'])
                    self.assertTrue(HOST.forget_emugui_game(first['gameKey']))
                    self.assertEqual(HOST.emugui_game_status(first['gameKey'])['state'], 'unbound')
            finally:
                HOST.CONFIG_PATH = original

    def test_emugui_game_status_reports_actionable_binding_failures(self):
        with TemporaryDirectory(dir=TEST_TEMP_ROOT) as directory:
            root = Path(directory)
            config_path = root / 'native-config.json'
            original = HOST.CONFIG_PATH
            HOST.CONFIG_PATH = str(config_path)
            game_key = 'game_abcdefghijklmnop'
            entry = {
                'libraryId': 'spectrum', 'gameId': 'jetpac', 'emulatorId': 'eightyone',
                'profileId': 'profile-48k', 'label': 'Jetpac'
            }
            HOST.save_config({'approvedGames': {game_key: entry}})
            control = {'active': 'other', 'game': True, 'emulator': True, 'profile': True}

            class FakeEmuGui:
                COLLECTION = root

                @staticmethod
                def dispatch_emugui_read(method, params=None):
                    if method == 'STATUS':
                        return {
                            'active': {'id': control['active']},
                            'emulators': ([{'id': 'eightyone', 'name': 'EightyOne', 'available': True}] if control['emulator'] else []),
                            'profiles': ([{'id': 'profile-48k', 'name': '48K', 'emulator_id': 'eightyone'}] if control['profile'] else [])
                        }
                    if method == 'GET_GAME' and control['game']:
                        return {'game': {'id': 'jetpac', 'title': 'Jetpac', 'path': str(root / 'Jetpac.tap')}}
                    raise ValueError('Unknown game')

            try:
                with patch.object(HOST, '_load_emugui_module', return_value=FakeEmuGui):
                    self.assertEqual(HOST.emugui_game_status(game_key)['state'], 'library-missing')
                    control['active'] = 'spectrum'
                    control['game'] = False
                    self.assertEqual(HOST.emugui_game_status(game_key)['state'], 'game-missing')
                    control['game'] = True
                    control['emulator'] = False
                    self.assertEqual(HOST.emugui_game_status(game_key)['state'], 'emulator-missing')
                    control['emulator'] = True
                    control['profile'] = False
                    self.assertEqual(HOST.emugui_game_status(game_key)['state'], 'profile-missing')
                    self.assertIn('game=jetpac', HOST.emugui_game_link(game_key))
            finally:
                HOST.CONFIG_PATH = original

    def test_game_system_identity_covers_planned_emulator_families(self):
        cases = (
            ({'system': 'ZX Spectrum 128K'}, {}, ('zx-spectrum', 'ZX Spectrum')),
            ({'system': '48K-128K'}, {}, ('zx-spectrum', 'ZX Spectrum')),
            ({}, {'emulatorId': 'hatari'}, ('atari-st', 'Atari ST')),
            ({'platform': 'Game Boy Color'}, {}, ('game-boy', 'Game Boy')),
            ({}, {'emulatorId': 'snes9x'}, ('snes', 'Super Nintendo')),
            ({}, {'emulatorId': 'scummvm'}, ('scummvm', 'ScummVM')),
            ({}, {'emulatorId': 'dosbox-staging'}, ('dosbox', 'DOSBox')),
            ({'system': 'Arcade'}, {}, ('mame', 'Arcade / MAME')),
        )
        for game, entry, expected in cases:
            with self.subTest(expected=expected[0]):
                self.assertEqual(HOST._game_system_info(game, entry), expected)

    def test_remote_emugui_artwork_is_bounded_and_https_only(self):
        game = {
            'loading_screen': 'https://cdn.thegamesdb.net/images/original/boxart/front/17951-1.jpg',
            'screenshot': 'https://example.com/fallback.png'
        }
        downloaded = {
            'contentType': 'image/jpeg',
            'dataUrl': 'data:image/jpeg;base64,aW1hZ2U=',
            'bytes': 5
        }
        with patch.object(HOST, '_download_favicon_candidate', return_value=downloaded) as fetch:
            self.assertEqual(HOST._emugui_binding_thumbnail(object(), game), downloaded['dataUrl'])
            fetch.assert_called_once_with(game['loading_screen'], HOST.MAX_APPLICATION_ICON_BYTES)
        with patch.object(HOST, '_download_favicon_candidate') as fetch:
            self.assertEqual(HOST._emugui_binding_thumbnail(object(), {'screenshot': 'http://example.com/image.png'}), '')
            fetch.assert_not_called()

    def test_emugui_artwork_can_fall_back_to_an_exact_same_system_sibling(self):
        class FakeEmuGui:
            COLLECTION = ''

            @staticmethod
            def dispatch_emugui_read(method, params=None):
                self.assertEqual(method, 'SEARCH_GAMES')
                return {'games': [
                    {'id': 'other-system', 'title': 'Ghostbusters', 'system': 'Atari ST', 'loading_screen': 'https://example.com/atari.jpg'},
                    {'id': 'spectrum-art', 'title': 'Ghostbusters', 'system': '128K', 'loading_screen': 'https://example.com/spectrum.jpg'},
                ]}

        game = {'id': 'bound-game', 'title': 'Ghostbusters', 'system': '48K'}
        downloaded = {'contentType': 'image/jpeg', 'dataUrl': 'data:image/jpeg;base64,c3BlY3RydW0=', 'bytes': 8}
        with patch.object(HOST, '_download_favicon_candidate', return_value=downloaded) as fetch:
            self.assertEqual(HOST._emugui_binding_thumbnail(FakeEmuGui(), game), downloaded['dataUrl'])
            fetch.assert_called_once_with('https://example.com/spectrum.jpg', HOST.MAX_APPLICATION_ICON_BYTES)


def tearDownModule():
    try:
        TEST_TEMP_ROOT.rmdir()
    except OSError:
        pass


if __name__ == '__main__':
    unittest.main()
