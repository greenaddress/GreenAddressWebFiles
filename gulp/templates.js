var gulp = require('gulp');
var run = require('gulp-run');
var clean = require('gulp-clean');

gulp.task('clean-templates', function () {
  return gulp.src([
      'de',
      'el',
      'en',
      'es',
      'fr',
      'it',
      'nl',
      'pl',
      'ru',
      'sv',
      'th',
      'uk'
    ].map(function (lang) { return 'build/static/' + lang; }), {read: false})
    .pipe(clean());
});

gulp.task('templates', ['clean-templates'], function () {
  return run('python render_templates.py build').exec();
});
