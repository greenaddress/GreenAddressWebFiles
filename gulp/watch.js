var gulp = require('gulp');

gulp.task('listen', function () {
  gulp.watch('static/css/**/*.css', ['css']);
  gulp.watch('static/js/**/*.js', ['js']);
  gulp.watch('templates/**/*.html', ['templates']);
});
