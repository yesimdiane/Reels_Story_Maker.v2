# Studio v2.3 — 클라우드 Story Lab 파이프라인

## 워크플로
제품 URL → 참조 이미지 → **Story Lab(컨셉 ≥3, 필수)** → 사람 승인 → 대본 스튜디오 → 스토리보드 → 비디오 스튜디오 → 최종 검토 → 게시.
제품에서 대본으로 바로 가는 경로는 없습니다(`POST /api/episodes`는 `conceptId` 필수, 레거시 수동 생성만 `manual:true`).

## 제품 / 참조 이미지 (`studio/lib/products.js`, `extract.js`)
- 추출은 http/https(80/443)만, 사설 IP 차단(DNS 고정), 리다이렉트 ≤3, robots.txt 준수, 정직한 User-Agent, 크기/시간 상한. 로그인·캡차·봇 차단은 **우회하지 않고** 수동 입력 안내로 전환.
- 추출된 사양은 "미확인" 상태이며 사람이 확인해야 사용됩니다. **가격은 추출하지 않습니다.** 없는 정보를 만들지 않습니다.
- 이미지 종류: retrieved / uploaded(최대 5) / ai_generated — 출처·라이선스 메모 표시, 승인/거절/교체/비교. 승인된 참조 세트는 sha256 해시에 묶여, 이후 변경되면 "오래됨(stale)"으로 표시. 사유와 함께 면제(waive) 가능.

## Story Lab (`storylab.js`)
- 생성 결과 검증: 3개 이상, Jaccard 유사도로 서로 달라야 함, 금지 표현("오빠", 근거 없는 효능 주장 등) 거부. 검증 실패 시 **아무것도 저장하지 않음**.
- 컨셉 필드: title, hook, situation, productRole, Jack/Diane 사용 방식, payoff, viewerAppeal, ctaDirection, duration.
- 상태: candidate → approved / rejected / superseded. 수정하면 revision이 올라가고 재승인이 필요. 거절 컨셉도 보관.
- 승인 기록: 제품 ID, 컨셉 ID·revision, provider/model, 프롬프트 버전, 참조 이미지 ID, 상태, 타임스탬프.

## 대본 스튜디오 (`scriptgen.js`)
승인된(현재 revision) 컨셉에서만 생성. 에피소드에 `concept`·`scriptSource` 추적 정보, 버전 스냅샷 기록. 컨셉이 바뀌면 대본 승인이 차단되고 "재생성 필요" 표시.

## 설정
- **AI 연동**: Gemini / OpenAI / Anthropic / Muapi / HeyGen. 키는 서버에서 암호화(AES-256-GCM, scrypt)되어 저장되며 응답에는 마스킹 정보만. 상태: 미설정 / 연결됨 / 인증 실패 / 모델 ID 오류 / 한도 초과 / 제공자 오류. 모델 ID는 제공자 API로 검증. 실제 모드 전환은 키 + 확인 문구 `LIVE` 필요.
- **프롬프트 매니저**: Story Concept, Script, Storyboard, Character Consistency, Product Accuracy, CTA & Affiliate. 편집·저장·기본값 복원·버전 이력·미리보기·제공자/모델 선택. 결과에 프롬프트 버전이 기록됨. 기본 채널 "서울에서 집꾸미기"의 Diane/Jack 규칙이 시드.
- **사용량·한도**: 추정 vs 실제(또는 계산) 비용, 일/월 한도(UTC), 건별 유료 확인, 중복 작업 방지, 사용 내역·오류 로그. 토큰 단가는 운영자 입력.
- 기본 라우팅은 `mock`(“[샘플]” 표시). 유료 제공자로 **자동 전환하지 않습니다**.

## 데이터 / 마이그레이션 → `docs/MIGRATION-V2.3.md`
## 배포 → `docs/DEPLOYMENT.md`

## 테스트
`npm test` (mock 제공자만 사용, 유료 호출 없음). v2.3 신규 28개: `tests/v23-*.test.js`.
