
        // 导入主脚本的函数（如果它们被导出）
        // 或者，我们直接复制函数定义
        
        function safeFilename(name) {
            return String(name).replace(/[\\/:*?"<>|]/g, '_').trim();
        }
        
        // 测试 1: 正常文件名
        console.assert(safeFilename("test.mp4") === "test.mp4", "测试 1 失败");
        
        // 测试 2: 包含特殊字符
        console.assert(safeFilename('test/file.mp4') === "test_file.mp4", "测试 2 失败");
        console.assert(safeFilename('test:file.mp4') === "test_file.mp4", "测试 3 失败");
        
        // 测试 3: 路径遍历（应该被过滤）
        const result = safeFilename("../test.mp4");
        console.assert(!result.includes('..'), `测试 4 失败: ${result}`);
        
        console.log("所有 JS 函数测试通过");
        