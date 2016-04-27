var gulp = require('gulp');
var clean = require('gulp-clean');

gulp.task('clean-css', function () {
  return gulp.src(['build/static/css/'], {read: false})
    .pipe(clean());
});

gulp.task('build-css', ['clean-css'], function () {
  return gulp.src(['static/css/**/*'])
    .pipe(gulp.dest('build/static/css'));
});
