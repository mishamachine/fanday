#!/usr/bin/env python3
"""UI helpers for the Android emulator run. Reads a uiautomator dump (XML) and finds nodes by text.
  ui.py find  <xml> <text>   -> prints "x y" (centre of first node whose text/content-desc contains <text>, case-insensitive); exit 1 if none
  ui.py rows  <cp-output>    -> prints "_id dtstart" lines from `content query` output
"""
import re, sys, xml.etree.ElementTree as ET

def find(xml_path, text):
    try:
        root = ET.parse(xml_path).getroot()
    except Exception:
        return None
    want = text.lower()
    best = None
    for n in root.iter('node'):
        label = ((n.get('text') or '') + ' ' + (n.get('content-desc') or '')).lower()
        if want in label:
            m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds') or '')
            if not m:
                continue
            x0, y0, x1, y1 = map(int, m.groups())
            if x1 <= x0 or y1 <= y0:
                continue
            cand = ((x0 + x1) // 2, (y0 + y1) // 2)
            # prefer clickable nodes, else first match
            if n.get('clickable') == 'true':
                return cand
            best = best or cand
    return best

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'find':
        r = find(sys.argv[2], sys.argv[3])
        if not r:
            sys.exit(1)
        print(*r)
    elif cmd == 'rows':
        for line in open(sys.argv[2], errors='replace'):
            if line.startswith('Row:'):
                i = re.search(r'\b_id=(\d+)', line); d = re.search(r'\bdtstart=(\d+)', line)
                print(i.group(1) if i else '?', d.group(1) if d else '?')
