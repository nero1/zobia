/// <reference types="react" />

// Stub for nativewind v4 — adds className prop support to all React Native
// components. The real nativewind package ships its own version of this file;
// this stub satisfies TypeScript when the package isn't installed locally
// (CI, remote containers) without breaking IntelliSense when it is.
declare module 'react-native' {
  interface ViewProps {
    className?: string;
  }
  interface TextProps {
    className?: string;
  }
  interface ImageProps {
    className?: string;
  }
  interface TextInputProps {
    className?: string;
  }
  interface ScrollViewProps {
    className?: string;
  }
  interface TouchableOpacityProps {
    className?: string;
  }
  interface PressableProps {
    className?: string;
  }
  interface FlatListProps<ItemT> {
    className?: string;
  }
}

export {};
