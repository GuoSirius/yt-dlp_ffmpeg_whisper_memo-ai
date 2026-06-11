/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],

  rules: {
    // 允许更长的 header（默认 72 太短）
    'header-max-length': [2, 'always', 150],

    // 允许 body 使用任意格式
    'body-leading-blank': [1, 'always'],
    'body-max-line-length': [2, 'always', 200],

    // footer 前需要空行
    'footer-leading-blank': [1, 'always'],

    // type 枚举（扩展了 conventional 的默认值）
    'type-enum': [
      2,
      'always',
      [
        'feat',     // 新功能
        'fix',      // 修复 bug
        'docs',     // 文档变更
        'style',    // 代码格式（不影响功能）
        'refactor', // 重构（非新功能，非修 bug）
        'perf',     // 性能优化
        'test',     // 测试相关
        'chore',    // 构建/工具/依赖变更
        'ci',       // CI/CD 变更
        'build',    // 构建系统变更
        'revert',   // 回滚
      ],
    ],

    // scope 可选但推荐小写
    'scope-case': [2, 'always', 'lower-case'],
  },
};
