// 登录验证脚本
document.addEventListener('DOMContentLoaded', function() {
    // 默认密码，您可以修改为自定义密码
    const DEFAULT_PASSWORD = '962464';
    
    // 检查是否已登录
    function checkAuthStatus() {
        const isAuthenticated = sessionStorage.getItem('solara_authenticated') === 'true';
        if (isAuthenticated) {
            showApp();
            return true;
        }
        return false;
    }
    
    // 显示登录界面
    function showLogin() {
        document.getElementById('loginContainer').style.display = 'flex';
        document.getElementById('appContainer').style.display = 'none';
    }
    
    // 显示主应用界面
    function showApp() {
        document.getElementById('loginContainer').style.display = 'none';
        document.getElementById('appContainer').style.display = 'block';
    }
    
    // 验证密码
    function authenticate(password) {
        // 这里使用简单的密码验证，您可以根据需要修改
        // 例如，可以添加多个有效密码
        const validPasswords = [
            DEFAULT_PASSWORD,
            'qianxiuadmin'
        ];
        
        return validPasswords.includes(password);
    }
    
    // 显示错误信息
    function showError(message) {
        const errorElement = document.getElementById('loginError');
        errorElement.textContent = message;
        errorElement.style.display = 'block';
        
        // 3秒后自动隐藏错误信息
        setTimeout(() => {
            errorElement.style.display = 'none';
        }, 3000);
    }
    
    // 处理登录按钮点击
    document.getElementById('loginBtn').addEventListener('click', function() {
        const password = document.getElementById('passwordInput').value;
        
        if (!password) {
            showError('请输入密码');
            return;
        }
        
        if (authenticate(password)) {
            // 密码正确，设置登录状态并显示主应用
            sessionStorage.setItem('solara_authenticated', 'true');
            showApp();
        } else {
            // 密码错误，显示错误信息
            showError('密码错误，请重试');
            // 清空密码输入框
            document.getElementById('passwordInput').value = '';
        }
    });
    
    // 处理回车键登录
    document.getElementById('passwordInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            document.getElementById('loginBtn').click();
        }
    });
    
    // 初始化：检查登录状态
    if (!checkAuthStatus()) {
        showLogin();
    }
    
    // 添加退出登录功能
    window.logout = function() {
        sessionStorage.removeItem('solara_authenticated');
        showLogin();
        document.getElementById('passwordInput').value = '';
    };
    
    // 绑定退出登录按钮事件
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            if (confirm('确定要退出登录吗？')) {
                logout();
            }
        });
    }
    
    // 绑定移动端退出登录按钮事件
    const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');
    if (mobileLogoutBtn) {
        mobileLogoutBtn.addEventListener('click', function() {
            if (confirm('确定要退出登录吗？')) {
                logout();
            }
        });
    }
    
    // 暴露检查登录状态的函数，供其他脚本使用
    window.isAuthenticated = function() {
        return sessionStorage.getItem('solara_authenticated') === 'true';
    };
});