---
name: lean-coding
version: "2.0.0"
agent_created: true
description: 省积分编码规范。积分消耗 = 工具调用次数 × 每次结果的上下文累积。核心是减少调用次数和每次读取量。
triggers:
  - "修改代码"
  - "修复"
  - "开发"
  - "fix"
  - "refactor"
auto_activate: true
---

# lean-coding — 省积分编码

## 根因：为什么积分暴增

每次工具调用的结果都累加进上下文。第 N 次调用时，模型重新处理前 N-1 次的全部内容。15 次调用的总成本远大于 3 次调用的 5 倍——是指数级增长，不是线性。

**积分 = 调用次数 × 上下文累积体积。两个都要压。**

## 5 条铁律（违反即浪费）

### 1. 先想完再动手
收到需求后，先在回复中用文字列出完整修改方案（改哪个文件、哪几行、怎么改），确认无误后**一次性批量执行所有 Edit**。禁止"读一点→改一点→再读→再改"的试探式开发。

### 2. Grep 拿行号，Read 一次到位
- `Grep pattern -n true -C 2` 拿到行号和少量上下文
- 根据 Grep 结果，**最多 Read 一次**，offset+limit 覆盖目标区域
- **禁止**对同一文件区域 Read 第二次——内容已在上下文中

### 3. 同一文件最多 Read 2 次
- 第 1 次：Grep 定位后的精读
- 第 2 次：Edit 前的补充读取（如果第 1 次没覆盖到）
- 第 3 次 = 浪费。内容已经在上下文里了

### 4. Edit 优于 Write，批量优于串行
- 改几行用 Edit，不要 Write 整个文件
- 同一文件的多个独立 Edit **放在一条消息里并行发**
- 不同文件的 Edit 也合并到一条消息

### 5. 禁止冗余验证
- Edit 成功后**不要 Read 回看**
- **不要** Bash cat 验证写入内容
- **不要** `node --check` / `py_compile` 除非改动有语法风险
- 信任工具的返回结果

## 速查表

| 场景 | 错误做法（贵） | 正确做法（省） |
|------|--------------|--------------|
| 找函数在哪 | Read 整个文件 | Grep files_with_matches |
| 看函数实现 | Read 整个文件 | Grep -C 3 拿行号 → Read offset 一次 |
| 改 3 行代码 | Read 全文 → Write 全文 | Grep → Read 60 行 → Edit |
| 同文件改 3 处 | 3 条消息各 1 个 Edit | 1 条消息 3 个并行 Edit |
| 确认改对了 | Edit 后 Read 回看 | 看 Edit 返回的 "Successfully" 即可 |
| 搜索关键词 | Bash grep | Grep 工具（更省、更干净）|

## 本项目专属

- `process_videos.py` ~3200 行：**永不整读**，MEMORY.md 有关键行号
- `process_videos.js` ~2000 行：同上
- 改之前先查 `.workbuddy/memory/MEMORY.md`，比重新探索代码便宜 10 倍
- commitlint：subject 不能大写开头
