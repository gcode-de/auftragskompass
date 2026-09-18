"""Regression tests for documentation checks, using temporary synthetic files."""
import importlib.util
import tempfile
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('check_docs', ROOT / 'scripts/check_docs.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DocumentationTests(unittest.TestCase):
    def test_git_privacy_boundary(self):
        ignored = ['private-synthetic-customer.txt', 'apps/api/.env',
                   'apps/api/uploads/synthetic.pdf', 'packages/core/secrets/synthetic.txt',
                   'infrastructure/backups/synthetic.sql', 'apps/admin/dist/index.html']
        allowed = ['apps/api/src/example.ts', 'README.md', 'scripts/check_docs.py']
        result = subprocess.run(
            ['git', 'check-ignore', '--no-index', '--stdin'], cwd=ROOT,
            input='\n'.join(ignored + allowed) + '\n', text=True, capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), ignored)

    def test_repository(self):
        self.assertEqual(MODULE.validate(ROOT), [])

    def test_invalid_documents_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'docs').mkdir()
            (root / 'Lastenheft_Fotobox-Verwaltung_MVP.md').write_text('**SYS-01 MUSS:** Example\n**SYS-02 MUSS:** Example')
            (root / 'IMPLEMENTATION_PLAN.md').write_text('| C001 | example |\n')
            (root / 'README.md').write_text('[broken](missing.md)')
            (root / 'AGENTS.md').write_text('Synthetic fixture')
            (root / 'docs/requirements.md').write_text('| SYS-01, SYS-01, SYS-99 | C999 | example |')
            errors = '\n'.join(MODULE.validate(root))
            for expected in ['Unmapped requirement: SYS-02', 'Unknown requirement: SYS-99',
                             'Duplicate requirement mapping', 'Invalid slice mapping', 'Broken local link']:
                self.assertIn(expected, errors)


if __name__ == '__main__':
    unittest.main()
