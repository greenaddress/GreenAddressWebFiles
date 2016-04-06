var gulp = require('gulp');
var merge = require('merge-stream');
var clean = require('gulp-clean');

gulp.task('clean-assets', function () {
  return gulp.src([
      'build/static/fonts/',
      'build/static/img/',
      'build/static/sound/'
    ], {read: false})
    .pipe(clean());
});

gulp.task('assets', ['clean-assets'], function () {
  var fonts = gulp.src(['static/fonts/**/*'], {base: '.'})
    .pipe(gulp.dest('build/static/fonts'));

  var img = gulp.src(['static/img/**/*'], {base: '.'})
    .pipe(gulp.dest('build/static/img'));

  var sound = gulp.src(['static/sound/**/*'], {base: '.'})
    .pipe(gulp.dest('build/static/sound'));

  return merge(fonts, img, sound);
});
