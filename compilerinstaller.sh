#!/bin/zsh

# 1. Xcode 명령줄 도구 설치 (팝업창이 뜨면 완료될 때까지 기다려야 합니다)
echo "Installing Xcode Command Line Tools..."
xcode-select --install

# 2. Homebrew가 없는 경우 자동 설치
if ! command -v brew &> /dev/null; then
    echo "Homebrew not found. Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://githubusercontent.com)"
    
    # M1/M2/M3/M4 실리콘 맥을 위한 Homebrew 경로 환경변수 등록
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
    eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# 3. CMake 설치
echo "Installing CMake..."
brew install cmake

echo "All installations completed!"
