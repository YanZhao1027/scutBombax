#!/usr/bin/env python3
"""Renew the separate browser-trusted LAN certificate when < 30 days remain.

Certbot authenticates using a Cloudflare DNS token mounted read-only.
Never uses the admissions site's certificate, private key, or Nginx instance.
The Let's Encrypt official CNAME target is resolved afresh; TLS verification stays on.
"""
from pathlib import Path
import fcntl
import json
import os
import re
import subprocess
import urllib.request

home = Path.home()
cfg = home / '.config/bombax-activity-origin/certbot'
certificate = cfg / 'etc/live/bombax-activity-lan/fullchain.pem'
dns_credentials = Path('/home/zyubuntu/audition-campus-5090/https/secrets/cloudflare.ini')
lock_path = cfg / '.renew.lock'

def checked(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def discover_acme_edge():
    query = 'https://cloudflare-dns.com/dns-query?name=acme-v02.api.letsencrypt.org&type=CNAME'
    request = urllib.request.Request(query, headers={'Accept':'application/dns-json'})
    with urllib.request.urlopen(request,timeout=15) as response:
        answers = json.load(response).get('Answer',[])
    targets = [str(a.get('data','')).rstrip('.').lower()
               for a in answers if a.get('type') == 5]
    allowed = [x for x in targets if re.fullmatch(r'[a-z0-9-]{15,80}\.pacloudflare\.com',x)]
    if not allowed or not any(x=='prod.api.letsencrypt.org' for x in targets):
        raise RuntimeError('Official LE CNAME chain not confirmed: abort renewal')
    edge = allowed[-1]
    # An actual HTTPS request validates the trust chain; never use skip-verify.
    with urllib.request.urlopen(f'https://{edge}/directory',timeout=15) as response:
        directory=json.load(response)
    if not str(directory.get('newAccount','')).startswith(f'https://{edge}/acme/'):
        raise RuntimeError('Unexpected ACME directory; abort renewal')
    return edge

def main():
    cfg.mkdir(mode=0o700,parents=True,exist_ok=True)
    with open(lock_path,'a+',encoding='ascii') as lock:
        os.chmod(lock_path,0o600)
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        if certificate.exists():
            fresh=subprocess.run(['openssl','x509','-in',str(certificate),
                                  '-checkend',str(30*86400),'-noout'],
                                 capture_output=True)
            if fresh.returncode==0:
                print('LAN_CERT_VALID_MORE_THAN_30_DAYS')
                return
        if not dns_credentials.is_file():
            raise RuntimeError('DNS credential file missing; refusing unsafe issuance')
        edge=discover_acme_edge()
        mount = lambda local,dest: '-v='+str(local)+':'+dest
        cmd=[
            'docker','run','--rm','--network','host',
            mount(cfg/'etc','/etc/letsencrypt'),
            mount(cfg/'lib','/var/lib/letsencrypt'),
            mount(cfg/'log','/var/log/letsencrypt'),
            mount(dns_credentials,'/run/dns-cloudflare.ini:ro'),
            'certbot/dns-cloudflare:v5.4.0','certonly','--dns-cloudflare',
            '--server',f'https://{edge}/directory',
            '--dns-cloudflare-credentials','/run/dns-cloudflare.ini',
            '--dns-cloudflare-propagation-seconds','45',
            '--non-interactive','--agree-tos','--register-unsafely-without-email',
            '--cert-name','bombax-activity-lan','--key-type','ecdsa',
            '-d','activity-lan.10273055.xyz'
        ]
        checked(*cmd,stdout=subprocess.DEVNULL)
        checked('docker','run','--rm','--network','none',
                mount(cfg,'/certbot'),
                '--entrypoint','sh','nginx:1.28-alpine',
                '-c','chown -R 1000:1000 /certbot',stdout=subprocess.DEVNULL)
        checked('openssl','x509','-in',str(certificate),'-checkend',
                str(35*86400),'-noout')
        checked('docker','kill','--signal','HUP','bombax-activity-campus-https',
                stdout=subprocess.DEVNULL)
        print('LAN_CERT_RENEWED_AND_NGINX_RELOADED')

if __name__=='__main__':main()
