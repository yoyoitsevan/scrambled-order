import os, sys
from playwright.sync_api import sync_playwright
D = os.path.dirname(os.path.abspath(__file__))
jobs = [('icon-background', 1024), ('icon-foreground', 1024), ('icon-only', 1024), ('splash', 2732)]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for name, size in jobs:
        pg = b.new_page(viewport={'width': size, 'height': size})
        pg.goto('file://' + os.path.join(D, 'src', name + '.svg'))
        pg.screenshot(path=os.path.join(D, name + '.png'), omit_background=True)
        pg.close()
    b.close()
import shutil; shutil.copy(os.path.join(D, 'splash.png'), os.path.join(D, 'splash-dark.png'))
print('rendered')
