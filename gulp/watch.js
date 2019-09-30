var gulp = require('gulp');

gulp.task('listen', function () {
  gulp.watch('static/css/**/*.css', gulp.series('css'));
  gulp.watch('static/js/**/*.js', gulp.series('js'));
  gulp.watch('templates/**/*.html', gulp.series('templates'));
});
