import subprocess, logging, os, os.path, sys
from itertools import dropwhile

import gettext
import jinja2
import jslex

reload(sys)
sys.setdefaultencoding('utf-8')  # make jinja decode utf8 strings automatically

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
    filenames = find_all_files(".", [".py"], IGNORED_DIRS)
    filenames_html = []
    filenames_html += find_all_files('templates', [".html"], IGNORED_DIRS)
    filenames_js = find_all_files("./build/static/", [".js"], IGNORED_DIRS)

    # Run xgettext.
    server_msgs = cleanup_msgs(run_gettext(filenames, for_js=False), True)
    for filename in filenames_html:
        msgs = run_jinja_extract(filename)
        server_msgs += "\n" + msgs
    js_msgs = cleanup_msgs(run_gettext(filenames_js, for_js=True), True)

    with open(os.path.join("locale", "django.pot"), "w") as f:
        f.write(server_msgs)
    with open(os.path.join("locale", "djangojs.pot"), "w") as f:
        f.write(js_msgs)

    make_locale_dirs()
    write_po_files("django")
    write_po_files("djangojs")


def cleanup_msgs(msgs, first_file):
    if not first_file:
        # Strip the shit at the begining.
        msgs = '\n'.join(dropwhile(len, msgs.split('\n')))
    else:
        msgs = msgs.replace('charset=CHARSET', 'charset=UTF-8')
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


def run_gettext(filenames, for_js):
    if for_js:
        for filename in filenames:
            # Convert to sth suitable for gettext.
            with open(filename, "rU") as f:
                data = f.read()
                if data:
                    data = jslex.prepare_js_for_gettext(data)
            filename2 = filename + ".c"
            with open(filename2, "w") as f:
                f.write(data)
        args = [
            'xgettext',
            '-d djangojs',
            '--language=C',
            '--keyword=gettext_noop',
            '--keyword=gettext_lazy',
            '--keyword=ngettext_lazy:1,2',
            '--keyword=pgettext:1c,2',
            '--keyword=npgettext:1c,2,3',
            '--from-code=UTF-8',
            '--add-comments=Translators',
            '--output=-',
        ]
        for filename in filenames:
            args.append(filename + ".c")
    else:
        args = [
            'xgettext',
            '-d django',
            '--language=Python',
            '--keyword=gettext_noop',
            '--keyword=gettext_lazy',
            '--keyword=nget:text_lazy:1,2',
            '--keyword=ugettext_noop',
            '--keyword=ugettext_lazy',
            '--keyword=ungettext_lazy:1,2',
            '--keyword=pgettext:1c,2',
            '--keyword=npgettext:1c,2,3',
            '--keyword=pgettext_lazy:1c,2',
            '--keyword=npgettext_lazy:1c,2,3',
            '--from-code=UTF-8',
            '--add-comments=Translators',
            '--output=-',
        ]
        for filename in filenames:
            args.append(filename)
    msgs = subprocess.check_output(args)
    if for_js:
        for filename in filenames:
            os.unlink(filename + ".c")
    return msgs


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
    with open(filename, "rU") as f:
        data = f.read()

    tr = gettext.translation(
                'django', 'locale', ['en'], fallback=True
            )

    trxs = jinja_env.extract_translations(data)
    msgs = ""
    for lineno, function, message in trxs:
        msgs += u"#: %s:%s\n" % (filename, lineno)
        if function == 'ngettext':
            msgs += u"msgid %s\n" % pot_str(message[0])
            msgs += u"msgid_plural %s\n" % pot_str(message[1])
            msgs += u"msgstr[0] \"\"\n"
            msgs += u"msgstr[1] \"\"\n\n"
        else:
            if isinstance(message, tuple):
                message = message[0]
            msgs += u"msgid %s\n" % pot_str(message)
            msgs += u"msgstr \"\"\n\n"
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

        args = ['msguniq', '--to-code=utf-8', '-o', potpath, potpath]
        subprocess.check_output(args)

        msgs = ""
        if os.path.exists(popath):
            args = [
                'msgmerge',
                '-q',
                popath,
                potpath,
            ]
            msgs = subprocess.check_output(args)
            msgs = msgs.replace("#. #-#-#-#-#  %s.pot (PACKAGE VERSION)  #-#-#-#-#\n" % domain, "")
        else:
            with open(potpath, "rU") as f:
                msgs = f.read()
        with open(popath, "w") as f:
            f.write(msgs)

    potpath = os.path.join("locale", domain + ".pot")
    os.unlink(potpath)
