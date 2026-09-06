# ChatGPT-Remote for Linux

설치된 공식 ChatGPT에서 별도의 Linux Remote Controller 개발 패키지를 만드는 로컬 빌드 도구다.
OpenAI 공식 배포판이 아니다. 공식 앱 파일/로그인 프로필을 덮어쓰지 않는다.

## 업데이트 후 한 번에 빌드

```bash
# 저장소 폴더에서, 일반 사용자로 실행
python3 one-shot.py --check
python3 one-shot.py --fetch-deps --install
```

`--fetch-deps`는 Ubuntu 저장소에서 TPM 헤더와 테스트용 swtpm 패키지를 내려받아
빌드 폴더에만 압축 해제한다. 시스템에는 설치하지 않는다.
`--install`을 생략하면 패키지만 생성한다. 설치 단계만 sudo를 사용한다.
실행 중인 ChatGPT-Remote가 있으면 빌드를 완료한 후 설치 직전에 중단한다.
출력된 `.deb`는 앱을 종료한 뒤 `sudo apt install /출력된/파일.deb`로 설치할 수 있다.
공식 ChatGPT 업데이트 자체는 이 스크립트가 수행하지 않는다.

지원: Ubuntu 24.04 amd64, 공식 앱 `26.901.20858`, `26.901.41600`의 검증된 ASAR 해시.
새 버전/다른 해시는 원본을 변경하지 않고 중단한다. 새 버전 지원 절차는 [UPDATING.md](UPDATING.md).
앱 내부 구현이 바뀌는 모든 미래 버전을 자동 지원하는 도구는 아니다.

## 준비

Python 3.11 이상, Node.js 22 이상, g++, APT/dpkg, AppArmor parser,
`desktop-file-utils`, TSS2 런타임이 필요하다. 이 호스트는 Node와 TSS2가 이미 설치되어 있다.
Ubuntu 기본 Node 패키지가 22 미만이면 별도로 Node 22 이상을 준비해야 한다.

```bash
sudo apt install g++ apparmor desktop-file-utils libtss2-dev
```

TPM 2.0 `/dev/tpmrm0`가 필요하다. 소프트웨어 개인 키 fallback은 없다.
TPM 접근 권한을 재부팅 후에도 유지하려면 한 번만 실행한다:

```bash
bash scripts/enable-tpm-access.sh
# 이후 로그아웃 후 다시 로그인
```

이는 현재 사용자를 `tss` 그룹에 추가한다. 해당 사용자의 모든 프로세스에 TPM 접근을 허용한다.
키 초기화, TPM clear, 소유권 변경, NV/persistent handle 생성은 하지 않는다.
자동 빌드/설치 과정에서는 이 권한을 변경하지 않는다.

## 적용하는 변경

- Linux용 TPM P-256 키 생성/서명/재로딩 backend를 추가한다.
- Controller 탭의 표시 조건만 강제로 활성화한다. 서버 게이트 값과 인증 검사는 유지한다.
- 승인 완료 페이지 복귀 링크에 `chatgpt-remote://` 전용 handler를 사용한다.
  OAuth localhost callback, state, PKCE 검증은 유지한다. 기존 `codex://` handler는 바꾸지 않는다.
- 패키지/명령 `chatgpt-remote`, 경로 `/opt/chatgpt-remote`, 창 그룹 `ChatGPT-Remote`를 사용한다.
- 사용자 설정/키는 `~/.config/ChatGPT-Remote/config/Codex`, CLI는
  `~/.config/ChatGPT-Remote/codex`에 분리한다. 기존 토큰/프로필을 복사하지 않는다.
- IBus 주소를 전달하고 분리된 설정 경로에서 기존 IBus 주소 파일만 참조한다.
  실제 한글 조합 입력은 사용 환경에서 재검증해야 한다.
- 복사본 경로 전용 AppArmor userns 규칙을 포함한다. sandbox를 끄지 않는다.

앱 내부 제품명은 그대로 남아 있다. 기존 앱의 프로젝트 목록 동기화 및 원격 프로젝트
선택 UI는 해결된 기능이 아니다. 강제 표시가 서버 접근 권한을 보장하지 않는다.

## 검증과 결과

매번 `build/runs/` 아래 새 작업 폴더를 사용해 이전 결과를 보존한다.
원본/기존 native module 해시, 정확한 변경 범위, ASAR 내용, JavaScript 문법,
실제 Desktop 키 wrapper를 포함한 swtpm 테스트 7개, APT 설치 시뮬레이션을 확인한다.
경로/해시는 각 실행 폴더의 `result.json`에 저장한다.

2026-09-06: `26.901.41600+remote.5` 전체 빌드와 7개 테스트 및 설치 시뮬레이션 통과.
새 빌드는 아직 설치하지 않았다. 이 버전의 GUI/실제 원격 동작은 검증 전이다.
이전 `26.901.20858+remote.3`에서 사용자 승인, TPM 서명 및 원격 연결 로그를 확인했다.

## GitHub에 올릴 내용

이 저장소는 빌드 스크립트, 자체 키 helper 및 테스트만 포함한다.
`build/`, `vendor/`, `profile/`, 로그, `.deb`, `.asar`, 키 파일은 제외한다.
공식 바이너리를 GitHub Release에 올리지 않는다. 사용자가 자기 설치본으로 로컬 빌드한다.
현재는 로컬 Git 저장소이며 원격 저장소로 업로드하지 않았다.

## 제거

```bash
sudo apt purge chatgpt-remote
```

사용자 프로필은 보존된다. 과거 수동 설정을 사용했다면 사용자 desktop override나
`~/.local/bin/chatgpt-remote-ime`도 별도 파일로 남을 수 있다.
TPM 그룹 권한을 회수하려면 `sudo gpasswd -d "$(id -un)" tss` 후 다시 로그인한다.
