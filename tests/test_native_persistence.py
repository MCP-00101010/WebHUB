import importlib.util
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


def tearDownModule():
    try:
        TEST_TEMP_ROOT.rmdir()
    except OSError:
        pass


if __name__ == '__main__':
    unittest.main()
