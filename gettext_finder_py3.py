import logging, os, os.path, sys, io
from itertools import dropwhile

from babel.messages.extract import extract_from_dir
from babel.messages.catalog import Catalog
from babel.messages.pofile import write_po, read_po
import gettext
import jinja2

logging.basicConfig(level=logging.DEBUG, stream=sys.stderr)
log = logging.getLogger('main')


IGNORED_DIRS = [".git", "build", "docs"]


GETTEXT_LANGUAGES = (
    'en',  # default
    'it',
    'de',
    'es',
    'fr',
    'nl',
    'el',
    'pl',
    'ru',
    'sv',
    'th',
    'uk',
)

GETTEXT_LANGUAGES_LOCALE = (
    'de',
    'en', # default
    'es',
    'fi',
    'fr',
    'el',
    'he',
    'hi',
    'hu',
    'il',
    'it',
    'nl',
    'pt',
    'pl',
    'ru',
    'sv',
    'th',
    'uk',
    'zh',
)

TEMPLATE_SEARCH_PATH = ['templates']

jinja_env = jinja2.Environment(
    autoescape=True,
    loader=jinja2.FileSystemLoader(TEMPLATE_SEARCH_PATH),
    extensions=['jinja2.ext.i18n', 'jinja2.ext.autoescape'],
)


def start():
    #log.info("WARNING: .pox and .mox files are produces as outputs. CHANGE IT FOR REAL USE")
    filenames_html = []
    filenames_html += find_all_files('templates', [".html"], IGNORED_DIRS)

    # Run xgettext.
    # Don't run for_js=False here since we don't have *.py in the webfiles repo
    server_msgs = ''
    # server_msgs = cleanup_msgs(run_gettext('.', for_js=False), True)
    for filename in filenames_html:
        msgs = run_jinja_extract(filename)
        server_msgs += "\n" + msgs
    js_msgs = cleanup_msgs(run_gettext('./build/static', for_js=True), True)

    with open(os.path.join("locale", "django.pot"), "w") as f:
        f.write(server_msgs)
    with open(os.path.join("locale", "djangojs.pot"), "wb") as f:
        f.write(js_msgs)

    make_locale_dirs()
    write_po_files("django")
    write_po_files("djangojs")


def cleanup_msgs(msgs, first_file):
    if not first_file:
        # Strip the shit at the begining.
        msgs = b'\n'.join(dropwhile(len, msgs.split(b'\n')))
    else:
        msgs = msgs.replace(b'charset=CHARSET', b'charset=UTF-8')
    return msgs


def find_all_files(path, extensions, ignored_dirs):
    matches = []
    for root, dirnames, filenames in os.walk(path, topdown=True):
        for dirname in dirnames:
            if dirname in ignored_dirs:
                dirnames.remove(dirname)
        for filename in filenames:
            _, ext = os.path.splitext(filename)
            if ext in extensions:
                matches.append(os.path.join(root, filename))
    return matches


def run_gettext(dirname, for_js):
    catalog = Catalog()
    for filename, lineno, message, comments, context in extract_from_dir(
        dirname,
        method_map=[('**.js', 'javascript')] if for_js else [('**.py', 'python')]
    ):
        catalog.add(message, None, [(filename, lineno)],
                    auto_comments=comments, context=context)

    sio = io.BytesIO()
    write_po(sio, catalog)

    return sio.getvalue()


def pot_str(s):
    if "\n" in s:
        outs = []
        for l in s.split('\n'):
            outs.append( '"%s"' % l.replace('"', '\\"' ))
        return "\n".join(outs)
    else:
        return '"%s"' % s.replace('"', '\\"' )


def run_jinja_extract(filename):
    log.info("Processing template %s", filename)
    with open(filename, "rU", encoding="utf-8") as f:
        data = f.read()

    tr = gettext.translation(
                'django', 'locale', ['en'], fallback=True
            )

    trxs = jinja_env.extract_translations(data)
    msgs = ""
    for lineno, function, message in trxs:
        msgs += "#: %s:%s\n" % (filename, lineno)
        if function == 'ngettext':
            msgs += "msgid %s\n" % pot_str(message[0])
            msgs += "msgid_plural %s\n" % pot_str(message[1])
            msgs += "msgstr[0] \"\"\n"
            msgs += "msgstr[1] \"\"\n\n"
        else:
            if isinstance(message, tuple):
                message = message[0]
            msgs += "msgid %s\n" % pot_str(message)
            msgs += "msgstr \"\"\n\n"
    return msgs


def make_locale_dirs():
    for locale in GETTEXT_LANGUAGES_LOCALE:
        try:
            os.mkdir(os.path.join("locale", locale))
            os.mkdir(os.path.join("locale", locale, "LC_MESSAGES"))
        except OSError:
            pass


def write_po_files(domain):
    for locale in GETTEXT_LANGUAGES_LOCALE:
        popath = os.path.join("locale", locale, "LC_MESSAGES", domain + ".po")
        potpath = os.path.join("locale", domain + ".pot")

        with open(popath, 'r', encoding="utf-8") as po_f, open(potpath, 'r', encoding="utf-8") as pot_f:
            template = read_po(pot_f)
            catalog = read_po(po_f)
            catalog.update(template)

        with open(popath, 'wb') as po_f:
            write_po(po_f, catalog, ignore_obsolete=True)

    potpath = os.path.join("locale", domain + ".pot")
    os.unlink(potpath)
