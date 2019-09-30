var gulp = require('gulp');
var clean = require('gulp-clean');

gulp.task('clean-assets', function () {
  return gulp.src([
    'build/static/fonts/',
    'build/static/img/',
    'build/static/sound/'
  ], {read: false, allowEmpty: true})
    .pipe(clean());
});

gulp.task('assets', gulp.series('clean-assets', function () {
  return gulp.src([
    'static/fonts/**/*',
    'static/img/**/*',
    'static/sound/**/*'
  ], {base: '.'})
    .pipe(gulp.dest('build/'));
}));
