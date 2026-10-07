import getSystem from '@/utils/get-system'
const OS = getSystem()

// default theme setting
export const defaultTheme = {
  primary_color: '#2457D6',
  secondary_color: '#FC9B76',
  primary_text: '#111827',
  secondary_text: '#5B6576',
  info_color: '#2457D6',
  error_color: '#E5484D',
  warning_color: '#F59E0B',
  success_color: '#0F8A5C',
  background_color: '#F5F5F5',
  font_family: `-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji"${
    OS === 'windows' ? ', twemoji mozilla' : ''
  }`,
}

// dark mode
export const defaultDarkTheme = {
  ...defaultTheme,
  primary_color: '#8DB4FF',
  secondary_color: '#FF9F0A',
  primary_text: '#F3F5F9',
  background_color: '#121829',
  secondary_text: '#A6B0C8',
  info_color: '#8DB4FF',
  error_color: '#FF6B6B',
  warning_color: '#FFB020',
  success_color: '#30D158',
}
