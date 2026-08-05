import importlib.util
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


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


def tearDownModule():
    try:
        TEST_TEMP_ROOT.rmdir()
    except OSError:
        pass


if __name__ == '__main__':
    unittest.main()
