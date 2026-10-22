#!/usr/bin/env python3
"""Consistent SQLite online backup plus private files, local retention.
Not a substitute for encrypted off-machine disaster recovery."""
import datetime, hashlib, json, os, pathlib, sqlite3, tarfile
base=pathlib.Path.home()/'.local/share/bombax-activity-origin'
backup=pathlib.Path.home()/'.local/share/bombax-activity-backups'
backup.mkdir(parents=True,exist_ok=True,mode=0o700)
os.chmod(backup,0o700)
ts=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
destination=backup/ts
destination.mkdir(mode=0o700)
database=base/'activity.sqlite'
if not database.exists():raise RuntimeError('authoritative database missing')
out=destination/'activity.sqlite'
with sqlite3.connect(f'file:{database}?mode=ro',uri=True) as source:
 with sqlite3.connect(out) as target:source.backup(target)
with sqlite3.connect(out) as verify:
 result=verify.execute('PRAGMA integrity_check').fetchone()[0]
 if result!='ok':raise RuntimeError('SQLite backup integrity check failed: '+result)
applied=verify.execute('SELECT COUNT(*) FROM _local_migrations').fetchone()[0]
if applied<6:raise RuntimeError('Migration mismatch in backup: '+str(applied))
archive=destination/'materials.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
 material=base/'materials'
 if material.exists():
  for item in material.rglob('*'):
   if item.is_file() and not item.is_symlink():
    tar.add(item,arcname=item.relative_to(base),recursive=False)
manifest={
 'at_utc':ts,
 'sqlite_sha256':hashlib.sha256(out.read_bytes()).hexdigest(),
 'materials_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
 'sqlite_integrity':'ok','migrations':applied,
 'scope':'LOCAL synthetic-only backup; no remote copy',
}
(destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
for file in destination.iterdir():os.chmod(file,0o600)
# Keep last seven local generations.
for previous in sorted(backup.iterdir(),reverse=True)[7:]:
 if not previous.is_dir() or not previous.name.endswith('Z'):continue
 for f in previous.iterdir():
  if f.is_file():f.unlink()
 previous.rmdir()
print('backup_ok:',str(destination),'integrity=ok','migrations='+str(applied))
