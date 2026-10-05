import json
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq


SCHEMA = pa.schema([
    ('id', pa.string()),
    ('nombre_solicitante', pa.string()),
    ('usuario', pa.string()),
    ('nombre_punto', pa.string()),
    ('clues', pa.string()),
    ('institucion', pa.string()),
    ('latitud', pa.float64()),
    ('longitud', pa.float64()),
    ('estado', pa.string()),
    ('estatus_revision', pa.string()),
    ('fecha_registro', pa.string()),
    ('fuente_coordenadas', pa.string()),
])


def read_rows(path: Path) -> None:
    if not path.exists():
        print('[]')
        return
    rows = pq.read_table(path).to_pylist()
    print(json.dumps(rows, ensure_ascii=False))


def write_rows(path: Path) -> None:
    rows = json.load(sys.stdin)
    table = pa.Table.from_pylist(rows, schema=SCHEMA)
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, path, compression='zstd')
    print(table.num_rows)


if __name__ == '__main__':
    action = sys.argv[1]
    parquet_path = Path(sys.argv[2])
    if action == 'read':
        read_rows(parquet_path)
    elif action == 'write':
        write_rows(parquet_path)
    else:
        raise ValueError('Acción no soportada: ' + action)