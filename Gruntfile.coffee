module.exports = ->
  @loadTasks "build/tasks"

  @registerTask "test", [
    "jshint"
    "jscs"
    "simplemocha"
    "karma:run"
  ]

  @registerTask "default", [
    "jshint"
    "jscs"
    "karma:daemon"
  ]
