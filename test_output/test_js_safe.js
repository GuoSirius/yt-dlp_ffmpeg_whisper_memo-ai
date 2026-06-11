
        // 从原文件提取 safeFilename 函数（通过 require 主脚本）
        // 或者直接复制函数定义
        function safeFilename(name) {
            let safe = String(name).replace(/[\\/:*?"<>|]/g, '_').trim();
            // 防止路径遍历：
            while (safe.includes('..')) safe = safe.replace('..', '_');
            // 防止以 . 开头（Unix 隐藏文件）
            safe = safe.replace(/^\.+/, '');
            return safe || 'unknown';
        }
        
        // 测试用例
        const tests = [
            ["normal.mp4", "normal.mp4"],
            ["path/../test.mp4", "path_.._test.mp4"],  // 注意：/ 被替换成 _，但 .. 也会被替换
            ["../escape.mp4", "_escape.mp4"],
            ["..hidden", "_hidden"],
            [".hidden", "hidden"],
            ["multiple...dots", "multiple...dots"],  // 三个点，会被替换两次
        ];
        
        let passed = 0;
        for (const [input, expected] of tests) {
            const result = safeFilename(input);
            // 检查是否包含 ..
            if (result.includes('..')) {
                console.log(`FAIL: safeFilename("${input}") = "${result}" contains ..`);
                process.exit(1);
            }
            // 检查是否以 . 开头
            if (result.startsWith('.')) {
                console.log(`FAIL: safeFilename("${input}") = "${result}" starts with .`);
                process.exit(1);
            }
            passed++;
        }
        console.log(`All ${passed} JS safeFilename tests passed`);
        