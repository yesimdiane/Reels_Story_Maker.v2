# Reels Factory Studio v2.3 — 클라우드 배포 가이드

Studio는 **단일 Docker 컨테이너**(Node 서버 + FFmpeg + 한글 폰트)와 **영구 볼륨 1개(`/data`)** 로 동작합니다.
Mac 백엔드, `npm run studio`, 로컬 `.env` 편집이 필요 없습니다. 브라우저에서 접속해 Settings → AI 연동에서 키를 입력합니다(암호화 저장).

> GitHub Actions는 **테스트(CI)** 에만 쓰며 백엔드로 쓰지 않습니다 (`.github/workflows/ci.yml`).

## 구조
| 구성요소 | 위치 |
|---|---|
| 프론트엔드 + API | 같은 컨테이너의 `studio/server.js` (정적 파일 + `/api/*`) |
| 데이터(JSON), 에셋(이미지/클립/렌더), 백그라운드 잡 로그 | 볼륨 `/data` (`RF_STUDIO_DIR`) |
| 서버측 FFmpeg 렌더 | 컨테이너 내부 (`ffmpeg`, `fonts-nanum`) |
| 자격증명 | `/data`에 AES-256-GCM 암호화 저장, 마스터키는 `RF_MASTER_KEY` 환경변수 |
| 작업 상태/재시도/오류 로그 | 에피소드 `jobs`(재개·dismiss API), Settings → 사용량·한도의 감사 로그 |
| 헬스체크 | `GET /healthz` |

## 환경변수
| 변수 | 필수 | 설명 |
|---|---|---|
| `RF_ENV=production` | 예 | Dockerfile 기본값. 아래 두 값이 없으면 서버가 **시작을 거부**합니다. |
| `RF_MASTER_KEY` | 예 | 32자 이상 임의 문자열. 저장된 API 키 암호화에 사용. **분실 시 저장된 키는 복구 불가**(재입력 필요). 변경하면 기존 키를 읽을 수 없음. |
| `RF_ADMIN_PASSWORD` | 예 | 12자 이상. 로그인 비밀번호(12시간 세션, 실패 5회/10분 제한). |
| `RF_PUBLIC_HOST` | 권장 | 예: `studio.example.com` — CSRF origin 검사에 사용. |
| `RF_STUDIO_DIR` | 아니오 | 기본 `/data`. |
| `GEMINI/OPENAI/ANTHROPIC/MUAPI/HEYGEN_API_KEY` | 아니오 | 환경변수로도 줄 수 있으나 **Settings에서 입력(암호화)** 권장. 저장된 값이 우선. |
| `RF_MUAPI_MODE`, `RF_STUDIO_VOICE_MODE` | 아니오 | 기본 `mock`. 실제 모드는 키 + 설정 화면에서 `LIVE` 입력 확인이 필요. |
| `RF_REEL_SPEND_LIMIT_USD` | 아니오 | 에피소드 지출 한도. |
| `RF_SHEETS_BRIDGE_URL/TOKEN` | 아니오 | 기존 Google Sheets 브리지(선택). |

비밀 값은 호스트의 Variables/Secrets에만 넣고 Git에 올리지 마세요. 마스터키 생성: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

## 방법 A — Railway (권장)
1. Railway → New Project → *Deploy from GitHub repo* → `yesimdiane/reels_factory`, 브랜치 `feature/studio-v2.3-cloud-story-lab`(머지 후 `main`). `railway.json`이 Dockerfile 빌드와 `/healthz`를 지정합니다.
2. **Volume** 추가, Mount path `/data`.
3. Variables: `RF_MASTER_KEY`, `RF_ADMIN_PASSWORD`, (`RF_PUBLIC_HOST` = 발급된 도메인). **replica는 1개**로 유지(JSON 파일 저장소는 단일 인스턴스 전제).
4. Settings → Networking → Generate Domain. `https://<도메인>/healthz` 가 `ok` 인지 확인.
5. 접속 → 로그인 → 설정 → *AI 연동*에서 키 입력 → *연결 테스트*(테스트는 무료 호출만, 유료 호출 없음).

### Railway 점검표 (배포 전 `npm run deploy:check` 로 자동 점검 가능)
| 항목 | 값 |
|---|---|
| Builder | Dockerfile (`railway.json`) — Dockerfile에 `VOLUME` 키워드를 쓰지 않습니다(Railway 볼륨과 충돌) |
| Volume | 서비스에 1개, **Mount path `/data`** (용량 1~3GB로 시작; 클립/렌더가 늘면 확장) |
| 볼륨 권한 | 컨테이너가 root로 시작해 `/data` 소유권을 정리한 뒤 uid 10001로 전환(`scripts/docker-entrypoint.sh`). 별도 `RAILWAY_RUN_UID` 불필요 |
| Variables(필수) | `RF_MASTER_KEY`, `RF_ADMIN_PASSWORD` |
| Variables(권장) | `RF_PUBLIC_HOST` = `${{RAILWAY_PUBLIC_DOMAIN}}` (참조 변수) |
| 자동 주입 | `PORT` (서버가 `0.0.0.0:$PORT`로 바인딩) |
| Healthcheck | `/healthz` (`railway.json`) |
| Replicas | 1 (JSON 파일 저장소는 단일 인스턴스 전제) |
| 넣지 말 것 | `RF_MUAPI_MODE=live`, `RF_STUDIO_VOICE_MODE=live` (처음엔 비워 둠 → mock) |

## 방법 B — Fly.io
```
fly launch --no-deploy --copy-config      # fly.toml의 app 이름/region 수정
fly volumes create rf_data --size 3 --region nrt
fly secrets set RF_MASTER_KEY=… RF_ADMIN_PASSWORD=…
fly deploy
```
머신 1대 유지(`min_machines_running=1`, 자동 정지 꺼짐). 렌더 중 메모리 부족이면 `fly scale memory 2048`.

## 비용 (공식 요금 페이지 확인, 2026-10 기준 — 변동 가능, 배포 전 재확인)
- **Railway Hobby**: $5/월(사용 크레딧 $5 포함) + RAM $10/GB·월, CPU $20/vCPU·월, 볼륨 $0.15/GB·월, 송신 $0.05/GB. 유휴 소형 서비스는 대체로 크레딧 안쪽; 렌더가 잦으면 초과.
- **Fly.io**: shared-cpu-1x 1GB ≈ $6.70/월 (2GB ≈ $12.70), 볼륨 $0.15/GB·월, 무료 티어 없음.
- AI/영상 API(Gemini·OpenAI·Anthropic·Muapi·HeyGen) 비용은 호스팅과 별개이며 **사용자가 설정한 한도 내에서, 건별 확인 후에만** 발생합니다. Muapi는 공개 단가표가 없어 단가를 운영자가 직접 입력해야 합니다(추정치는 "추정"으로 표시).

## 백업 / 복구
```
npm run backup                         # data → reels-factory-backup-<시각>.tar.gz (master.key 제외)
node scripts/restore-data.js <파일> --force   # 기존 data는 .before-restore-* 로 이동 후 복원
```
컨테이너에서는 `railway run` / `fly ssh console` 로 실행하고 파일을 내려받으세요. 볼륨 스냅샷(Railway 백업 / `fly volumes snapshots`)을 함께 쓰는 것을 권장합니다.

## 업데이트·롤백
- 배포 = 이미지 재빌드. 데이터는 볼륨에 남습니다. v2.3 최초 구동 시 스키마가 v3로 **가산 마이그레이션**되며(기존 EP01 등은 "레거시"로 표시, 제품 레코드가 추가되고 참조 이미지는 면제 처리) 기존 파일은 삭제하지 않습니다.
- 롤백: 이전 배포로 되돌리기 + 필요 시 위 복구 명령. 업그레이드 전 `npm run backup` 권장.

## 보안 메모
키는 서버에서만 복호화되고 API 응답에는 `configured / source / last4 / updatedAt` 만 나갑니다. 오류 응답은 `scrubSecrets` 처리. CSP·CSRF(헤더+Origin) 적용. HTTPS는 호스트가 종단합니다.
