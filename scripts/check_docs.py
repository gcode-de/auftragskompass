"""Validate local planning links and requirement-to-slice coverage (stdlib only)."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def validate(root):
    errors = []
    scope = (root / 'Lastenheft_Fotobox-Verwaltung_MVP.md').read_text()
    plan = (root / 'IMPLEMENTATION_PLAN.md').read_text()
    requirements = re.findall(r'\*\*([A-Z]+-\d+)\b', scope)
    slices = re.findall(r'^\| (C\d{3}) \|', plan, re.M)
    if not requirements or not slices:
        errors.append('Missing requirement or slice IDs')
    if slices != [f'C{number:03}' for number in range(1, len(slices) + 1)]:
        errors.append('Slices must be consecutive and ordered from C001')
    for label, values in [('requirement', requirements), ('slice', slices)]:
        if len(values) != len(set(values)):
            errors.append(f'Duplicate {label} ID')
    matrix_path = root / 'docs/requirements.md'
    if not matrix_path.exists():
        errors.append('Missing docs/requirements.md')
    else:
        matrix = matrix_path.read_text()
        mapped = []
        for row in matrix.splitlines():
            if not re.match(r'\| [A-Z]+-\d+', row):
                continue
            cells = row.split('|')
            if len(cells) < 4:
                errors.append(f'Malformed mapping: {row}')
                continue
            ids = re.findall(r'\b[A-Z]+-\d+\b', cells[1])
            refs = re.findall(r'\bC\d{3}\b', cells[2])
            mapped.extend(ids)
            if not refs or set(refs) - set(slices):
                errors.append(f'Invalid slice mapping: {row}')
        if len(mapped) != len(set(mapped)):
            errors.append('Duplicate requirement mapping')
        for value in sorted(set(requirements) - set(mapped)):
            errors.append(f'Unmapped requirement: {value}')
        for value in sorted(set(mapped) - set(requirements)):
            errors.append(f'Unknown requirement: {value}')
    paths = [root / 'README.md', root / 'AGENTS.md', root / 'IMPLEMENTATION_PLAN.md',
             root / 'Lastenheft_Fotobox-Verwaltung_MVP.md']
    paths.extend((root / 'docs').glob('*.md'))
    for path in paths:
        if not path.exists():
            errors.append(f'Missing {path.name}')
            continue
        for target in re.findall(r'\[[^\]]+\]\(([^\s)]+)\)', path.read_text()):
            if '://' in target or target.startswith('#'):
                continue
            if not (path.parent / target.split('#')[0]).exists():
                errors.append(f'Broken local link in {path.name}: {target}')
    return errors


if __name__ == '__main__':
    failures = validate(ROOT)
    print('\n'.join(failures) if failures else 'Planning links, IDs and requirement coverage: OK')
    sys.exit(bool(failures))
