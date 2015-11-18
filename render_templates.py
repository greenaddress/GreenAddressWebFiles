"""Renders GreenAddress templates."""

import argparse
import errno
import gettext
import glob
import os
import subprocess

import jinja2

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

TEMPLATES = {
    'wallet.html': 'wallet/wallet.html',
    'wallet/partials/*.html': 'wallet/partials/*.html',
    'wallet/partials/signuplogin/*.html':
        'wallet/partials/signuplogin/*.html',
}

TEMPLATE_SEARCH_PATH = ['templates']

try:
    # Used internally by GreenAddress for website deployment.
    # (Not useful for Cordova and Chrome apps, hence the optional import.)
    import render_templates_deployment
except ImportError:
    render_templates_deployment = None


_js_escapes = {
    ord(u'\\'): u'\\u005C',
    ord(u'\''): u'\\u0027',
    ord(u'"'): u'\\u0022',
    ord(u'>'): u'\\u003E',
    ord(u'<'): u'\\u003C',
    ord(u'&'): u'\\u0026',
    ord(u'='): u'\\u003D',
    ord(u'-'): u'\\u002D',
    ord(u';'): u'\\u003B',
    ord(u'\u2028'): u'\\u2028',
    ord(u'\u2029'): u'\\u2029'
}


def escapejs(txt):
    return txt.translate(_js_escapes)


class TemplatesRenderer(object):
    def __init__(self, hostname, outdir, cdvapp):
        self.hostname = hostname
        self.outdir = outdir
        self.cdvapp = cdvapp
        self.env = jinja2.Environment(
            autoescape=True,
            loader=jinja2.FileSystemLoader(TEMPLATE_SEARCH_PATH),
            extensions=['jinja2.ext.i18n', 'jinja2.ext.autoescape'],
        )
        self.trs = {}
        for lang in GETTEXT_LANGUAGES:
            self.trs[lang] = gettext.translation(
                'django', 'locale', [lang], fallback=True
            )
            if not isinstance(self.trs[lang], gettext.GNUTranslations):
                print "Translation file for %s not found." % lang

    def process_template(self, template, lang, output):
        tr = self.trs[lang]
        def to_unicode(s):
            if isinstance(s, unicode):
                return s
            else:
                return s.decode('utf-8')
        ugettext = lambda m: tr.ugettext(to_unicode(m.replace('\n', '')))
        def ungettext(s, p, n):
            tr.ungettext(
                # new lines in html are only for word wrapping, so skip them
                to_unicode(s.replace('\n', '')),
                to_unicode(p.replace('\n', '')),
                n
            )
        self.env.install_gettext_callables(ugettext, ungettext, newstyle=True)
        template = self.env.get_template(template)
        kwargs = {
            'HOSTNAME': self.hostname or 'localhost',
            'LANG': lang,
            'BASE_URL': '..' if self.cdvapp else '',
            'STATIC_URL': '../static' if self.cdvapp else '/static',
            'DEVELOPMENT': True,
            'PATH_NO_LANG': output,
            'cdvapp': self.cdvapp,
            'crapp': not self.cdvapp
        }
        out = template.render(**kwargs)
        try:
            os.makedirs(os.path.dirname(
                os.path.join(self.outdir, lang, output)
            ))
        except OSError as e:
            if e.errno != errno.EEXIST:
                raise
        with open(os.path.join(self.outdir, lang, output), 'w+') as f:
            f.write(out.encode('utf-8'))

    def generate_js_catalog(self, lang):
        tr = gettext.translation('djangojs', 'locale', [lang], fallback=True)
        s = """
function get_catalog(globals) {
globals.i18n_catalog = {\n"""
        entries = []
        plurals = {}
        for key, val in tr._catalog.items():
            if not key:
                continue
            if isinstance(key, tuple):
                if key[0] in plurals:
                    plurals[key[0]][key[1]] = val
                else:
                    plurals[key[0]] = {key[1]: val}
            else:
                entries.append('"%s": "%s"' % (escapejs(key), escapejs(val)))
        for key, val in plurals.items():
            sd = "{\n"
            sds = []
            for sk, sv in val.items():
                sds.append("    %s: '%s'" % (sk, escapejs(sv)))
            sd += ",\n".join(sds) + "}"
            entries.append('"%s": %s' % (escapejs(key), sd))
        s += ",\n".join(entries)
        s += "\n};}"
        with open(
                os.path.join(self.outdir, lang, 'i18n_catalog.js'), 'w'
                ) as f:
            f.write(s.encode('utf-8'))


def compile_domain(domain):
    for locale in GETTEXT_LANGUAGES:
        popath = os.path.join('locale', locale, "LC_MESSAGES", domain + ".po")
        mopath = os.path.join('locale', locale, "LC_MESSAGES", domain + ".mo")
        args = [
            'msgfmt',
            '--check-format',
            '-o',
            mopath,
            popath,
        ]
        try:
            subprocess.check_output(args)
        except subprocess.CalledProcessError:
            print "Error while processing domain/locale %s/%s" % (
                domain, locale)


def main():
    parser = argparse.ArgumentParser(description='Renders templates.')
    parser.add_argument('outdir', metavar='OUTDIR',
        help='The output directory')
    parser.add_argument('--hostname', '-n',
        help="Optional hostname of deployment (not used for Cordova/crx)")
    parser.add_argument('--cordova', '-a', action='store_true',
        help="Build HTML for Cordova project")

    args = parser.parse_args()

    compile_domain('django')
    compile_domain('djangojs')

    if render_templates_deployment:
        TEMPLATES.update(render_templates_deployment.TEMPLATES)
        TEMPLATE_SEARCH_PATH.extend(
            render_templates_deployment.TEMPLATE_SEARCH_PATH)

    renderer = TemplatesRenderer(
        hostname=args.hostname,
        outdir=args.outdir,
        cdvapp=args.cordova,
    )

    for output, templates in TEMPLATES.iteritems():
        if output.endswith('*.html'):
            for path in TEMPLATE_SEARCH_PATH:
                for fname in glob.glob(os.path.join(path, templates)):
                    fname = os.path.relpath(fname, path)
                    for lang in GETTEXT_LANGUAGES:
                        renderer.process_template(
                            fname,
                            lang,
                            output.replace('*.html', os.path.basename(fname))
                    )
        else:
            for lang in GETTEXT_LANGUAGES:
                renderer.process_template(templates, lang, output)

    for lang in GETTEXT_LANGUAGES:
        renderer.generate_js_catalog(lang)


if __name__ == '__main__':
    main()