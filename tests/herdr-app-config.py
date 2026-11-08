#!/usr/bin/env python3
"""Exercise Herdr's first-launch preferences through the real cmd_stow path."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path('home/.config/herdr-app')


class HerdrConfigTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='/tmp')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'dotfiles'
        self.home = self.root / 'home'
        (self.home / '.config').mkdir(parents=True)
        # Only portable files, never this machine's ignored runtime state.
        files = subprocess.check_output(
            ['git', 'ls-files', str(CONFIG)], cwd=ROOT, text=True).splitlines()
        files += ['lib/common.sh', 'lib/dotfiles.sh',
                  'scripts/configure-herdr-app.sh', 'scripts/prepare-herdr-fonts.py',
                  str(CONFIG / 'shared.defaults.json')]
        for name in set(files):
            source = ROOT / name
            if source.is_file():
                target = self.repo / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        self.config = self.repo / CONFIG
        self.state = self.config / 'shared.json'
        self.env = dict(os.environ, HOME=str(self.home), DOTFILES_DIR=str(self.repo))

    def stow(self, success=True):
        result = subprocess.run([
            'bash', '-euc', '''
source "$DOTFILES_DIR/lib/common.sh"
source "$DOTFILES_DIR/lib/dotfiles.sh"
cmd_merge() { :; }
cmd_stow
'''], env=self.env, capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def assert_preferences(self):
        state = json.loads(self.state.read_text()) if self.state.exists() else {}
        self.assertEqual(state.get('layout'), 'eli', 'Fresh launch must select eli, not main')
        self.assertEqual(state.get('workspace.panels'), [], 'Files/Changes buttons must be disabled')
        self.assertIn(state.get('frame.welcomed'), ('finished', 'skipped'))
        self.assertTrue((self.config / 'layouts/eli.json').is_file())
        settings = json.loads((self.config / 'settings.json').read_text())
        self.assertEqual(settings['theme'], 'arctic')
        self.assertTrue((self.config / 'themes/arctic.json').is_file())

    def test_font_uses_family_name_not_face_name(self):
        settings = json.loads((self.config / 'settings.json').read_text())
        self.assertEqual(settings['font'], 'Operator Mono Book Herdr')
        self.assertEqual(settings['ui_font'], 'Operator Mono Book Herdr')
        self.assertEqual(settings['font_size'], 16)
        layout = json.loads((self.config / 'layouts/eli.json').read_text())
        self.assertNotIn('font', layout, 'eli must inherit the tracked terminal font')

    def test_first_launch(self):
        self.stow()
        self.assert_preferences()
        self.assertTrue((self.home / '.config/herdr-app').is_symlink())

    def test_existing_runtime_is_preserved_and_managed_preferences_converge(self):
        runtime = {'layout': 'main', 'workspace.panels': ['files', 'changes'],
                   'space.colors': {'local-space': 'ansi3'},
                   'dotfiles.agents.order': {'addresses': ['t1']}}
        self.state.write_text(json.dumps(runtime))
        view = self.config / 'view.json'
        view.write_text('{"active":"local-space"}\n')
        self.stow()
        self.assert_preferences()
        updated = json.loads(self.state.read_text())
        for key in ('space.colors', 'dotfiles.agents.order'):
            self.assertEqual(updated[key], runtime[key])
        self.assertEqual(view.read_text(), '{"active":"local-space"}\n')
        before = self.state.stat().st_mtime_ns
        self.stow()
        self.assertEqual(self.state.stat().st_mtime_ns, before, 'No-op must not rewrite runtime state')

    def test_dismissed_welcome_is_kept(self):
        self.state.write_text(json.dumps({'frame.welcomed': 'skipped'}))
        self.stow()
        self.assert_preferences()
        self.assertEqual(json.loads(self.state.read_text())['frame.welcomed'], 'skipped')

    def test_invalid_runtime_is_not_clobbered(self):
        for content in ('{broken', '[]', 'null'):
            with self.subTest(content=content):
                self.state.write_text(content)
                self.stow(success=False)
                self.assertEqual(self.state.read_text(), content)

    def fake_app(self, script):
        stub = self.root / 'bin'
        stub.mkdir(exist_ok=True)
        app = stub / 'herdr-app'
        app.write_text('#!/bin/bash\n' + script + '\n')
        app.chmod(0o755)
        self.env['PATH'] = f"{stub}:{self.env['PATH']}"

    # Stands in for a live app: it owns shared.json and applies commands itself.
    LIVE_APP = '''
state="$HERDR_APP_HOME/shared.json"
case "$1 $2" in
  status*) exit 0 ;;
  "do layout.switch") jq --arg l "$4" '.layout = $l' "$state" > "$state.new" ;;
  "do navigator-status.set-shared:"*) jq --argjson v "${2#navigator-status.set-shared:}" '. + $v' "$state" > "$state.new" ;;
  *) exit 1 ;;
esac
mv "$state.new" "$state"
'''

    def test_running_app_is_configured_live(self):
        self.fake_app(self.LIVE_APP)
        self.state.write_text('{"layout":"main","local":"keep","frame.welcomed":"skipped"}')
        with socket.socket(socket.AF_UNIX) as sock:
            sock.bind(str(self.config / 'herdr-app.sock'))
            result = self.stow()
        self.assertIn('Configured running Herdr', result.stdout)
        self.assert_preferences()
        state = json.loads(self.state.read_text())
        self.assertEqual((state['local'], state['frame.welcomed']), ('keep', 'skipped'))

    def test_unresponsive_app_is_not_overwritten(self):
        self.state.write_text('{"layout":"main","local":"keep"}')
        before = self.state.read_bytes()
        with socket.socket(socket.AF_UNIX) as sock:
            sock.bind(str(self.config / 'herdr-app.sock'))
            for response in ('[ "$1" = status ]',  # Answers, but its commands fail.
                             'echo \'{"error":"the window did not answer"}\'; exit 1',
                             'echo "herdr-app: the window hung up" >&2; exit 1'):
                with self.subTest(response=response):
                    self.fake_app(response)
                    result = self.stow()  # Must never block the rest of stow.
                    self.assertIn('Could not apply', result.stderr)
                    self.assertEqual(self.state.read_bytes(), before)

    def test_stale_socket_does_not_block_setup(self):
        stub = self.root / 'bin'
        stub.mkdir()
        app = stub / 'herdr-app'
        app.write_text('#!/bin/sh\necho "herdr-app: no Herdr window at socket: Connection refused" >&2\nexit 1\n')
        app.chmod(0o755)
        self.env['PATH'] = f"{stub}:{self.env['PATH']}"
        with socket.socket(socket.AF_UNIX) as sock:
            sock.bind(str(self.config / 'herdr-app.sock'))
        self.stow()
        self.assert_preferences()


if __name__ == '__main__':
    unittest.main()
