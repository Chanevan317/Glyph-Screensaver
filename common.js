// Shared by extension.js and prefs.js (GLib only — no Shell or Gtk imports).
import GLib from 'gi://GLib';

/** Virtualenv created by install.sh with terminaltexteffects + pyfiglet. */
export const VENV = GLib.build_filenamev([GLib.get_user_data_dir(), 'glyph-screensaver', 'venv']);

/** Python that has terminaltexteffects and pyfiglet: the bundled venv, else the system python3. */
export function findPython() {
    const venvPython = GLib.build_filenamev([VENV, 'bin', 'python']);
    if (GLib.file_test(venvPython, GLib.FileTest.IS_EXECUTABLE))
        return venvPython;
    return GLib.find_program_in_path('python3');
}

/** Text to show: the configured text, or the user's login name in capitals. */
export function displayText(settings) {
    return settings.get_string('text').trim() || GLib.get_user_name().toUpperCase();
}
