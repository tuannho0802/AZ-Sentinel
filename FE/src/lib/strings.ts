/** Văn bản giao diện tập trung một nơi (Rules FE mục 6). */
export const strings = {
  appName: 'AZ Sentinel',
  apiOk: 'API OK',
  apiLoading: 'Đang kiểm tra API...',
  apiError: 'Không gọi được API',
  retry: 'Thử lại',

  checkingSession: 'Đang kiểm tra phiên đăng nhập...',
  sessionError: 'Không kiểm tra được phiên đăng nhập',

  loginTitle: 'Đăng nhập',
  email: 'Email',
  password: 'Mật khẩu',
  loginSubmit: 'Đăng nhập',
  loginSubmitting: 'Đang đăng nhập...',
  emailInvalid: 'Email không hợp lệ',
  passwordRequired: 'Nhập mật khẩu',
  loginFailed: 'Đăng nhập không thành công. Hãy thử lại.',
  logout: 'Đăng xuất',

  overviewTitle: 'Tổng quan',
  apiStatusTitle: 'Trạng thái API',
  sessionTitle: 'Phiên đăng nhập',
  linksTitle: 'Liên kết EA',
  linksEmpty: 'Chưa có liên kết EA.',
  linksEmptyHint: 'Tạo liên kết đầu tiên sẽ có ở Part 3.',

  notFoundTitle: 'Không tìm thấy trang',
  backHome: 'Về trang chủ',

  roles: { root_admin: 'rootAdmin', admin: 'Admin', user: 'User' },
} as const
