/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './lib/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Primary brand palette — no purple, no gradients
        brand: {
          blue: '#2563EB',
          'blue-light': '#3B82F6',
          'blue-dark': '#1D4ED8',
          green: '#16A34A',
          'green-light': '#22C55E',
          'green-dark': '#15803D',
          gold: '#D97706',
          'gold-light': '#F59E0B',
          'gold-dark': '#B45309',
        },
        // Neutral scale
        neutral: {
          0: '#FFFFFF',
          50: '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#9CA3AF',
          500: '#6B7280',
          600: '#4B5563',
          700: '#374151',
          800: '#1F2937',
          900: '#111827',
          950: '#030712',
        },
        // Semantic colors
        success: '#16A34A',
        warning: '#D97706',
        error: '#DC2626',
        info: '#2563EB',
      },
      fontFamily: {
        sans: ['System'],
      },
    },
  },
  plugins: [],
};
