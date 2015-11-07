"""Renders GreenAddress templates."""

import argparse
import errno
import gettext
import glob
import os
import subprocess

import jinja2

GETTEXT_LANGUAGES = (
    'en', # default
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
            self.trs[lang] = gettext.translation('django',
                'locale', [lang], fallback=True)
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


if __name__ == '__main__':
    main()