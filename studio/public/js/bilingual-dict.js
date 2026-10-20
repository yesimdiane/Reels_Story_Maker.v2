// Korean button label → English subtitle. Pure data + lookup (no DOM) so tests can import it in Node.
// Add new buttons here; `unknownLabels()` in bilingual.js lists anything shown without a subtitle.
export const EN = {
  '애니메이션 자동 생성': 'Generate animation', '무료로 만들기': 'Generate (free)',
  'AI 이미지 생성': 'Generate AI image', '프롬프트 저장': 'Save prompt', '초안으로 되돌리기': 'Reset to draft', '거절': 'Reject',
  '원본 보기': 'View full image', '참조 변경': 'Change reference', '캐릭터 참조 이미지': 'Character references', '기본 참조로 되돌리기': 'Reset to default reference',
  '연결 테스트': 'Test connection', '음성 목록 가져오기': 'Fetch voices', '연결 해제': 'Disconnect', '키 저장': 'Save key', '기본 목소리로 저장': 'Save as default voice', '미리듣기': 'Preview', '지정 해제': 'Clear voice', '제공자 연결': 'Connect provider', '목소리 변경': 'Change voice', '미리듣기 생성': 'Generate preview', '음성 연결': 'Voice connections',
  // navigation / generic
  '비용 확인 후 분석하기': 'Analyze (check cost)', '비용 확인 후 새로 분석하기': 'Re-analyze (check cost)', '분석하기': 'Analyze', '수정 저장': 'Save edit', '수정본을 새 버전으로 저장': 'Save as new version',
  '애니메이션': 'Animation', '보이스': 'Voice', '립싱크': 'Lip Sync', '편집': 'Editing', '영상 제작': 'Video Production', '스토리 랩 목록': 'Story Lab list', '필터 지우기': 'Clear filters', '카탈로그': 'Catalog',
  '대시보드': 'Dashboard', '제품 스튜디오': 'Product Studio', '스토리 랩': 'Story Lab', '에피소드': 'Episodes', '대본 스튜디오': 'Script Studio',
  '스토리보드': 'Image Studio', '이미지 스튜디오': 'Image Studio', '보이스 스튜디오': 'Voice Studio', '립싱크 스튜디오': 'Lip Sync Studio', '립싱크 만들기 (비용 확인)': 'Create lip sync (check cost)', '립싱크 다시 만들기 (비용 확인)': 'Redo lip sync (check cost)', '새로 만들기 (재생성)': 'Regenerate', '설정 저장': 'Save settings', '다음: 보이스 스튜디오': 'Next: Voice Studio', '음악 파일 올리기': 'Upload music', '플레이그라운드에서 확인함': 'Confirmed in playground', '모델 추가': 'Add model', '빼기': 'Remove', '이미지 스튜디오로 이동': 'Go to Image Studio', '제품 스튜디오': 'Product Studio', '스토리 랩': 'Story Lab', '비디오 스튜디오': 'Video Studio', '애니메이션 스튜디오': 'Animation Studio', '보이스': 'Voice', '렌더': 'Render', '최종 검토': 'Final Review', '게시': 'Publishing', '설정': 'Settings',
  '비디오': 'Video', '대본': 'Script', '스튜디오': 'Studio',
  '열기': 'Open', '닫기': 'Close', '취소': 'Cancel', '확인': 'OK', '저장': 'Save', '저장됨': 'Saved', '삭제': 'Delete', '편집': 'Edit', '이동': 'Go', '보기': 'View', '목록': 'List',
  '복사': 'Copy', '전체 복사': 'Copy all', '복사됨': 'Copied', '다운로드': 'Download', '교체': 'Replace', '복원': 'Restore', '되돌리기': 'Undo', '기록': 'History', '현재': 'Current', '검토': 'Review',
  '로그인': 'Log in', '로그아웃': 'Log out', '새 제품': 'New product', '다시 확인': 'Check again', '계속 편집': 'Keep editing',
  // products / story lab
  'URL에서 가져오기': 'Import from URL', '기능/사양 추가': 'Add feature / spec', '제품으로 이동': 'Go to product', '제품을 먼저 만드세요': 'Create a product first',
  '스토리 컨셉 생성': 'Generate story concepts', '스토리 랩으로 →': 'To Story Lab →', '쿠팡 파트너스 링크': 'Coupang Partners link', '후보로 되살리기': 'Back to candidates',
  '거절': 'Reject', '승인': 'Approve', '승인됨': 'Approved', '승인 완료': 'Approved', '승인 가능': 'Ready to approve', '승인 취소': 'Revoke approval', '최종 승인': 'Final approval',
  '준비됨': 'Ready', '준비 필요': 'Needs work', '비교': 'Compare', '이 버전 선택': 'Use this version', '이 버전으로 복원': 'Restore this version', '원본과 비교': 'Compare with original',
  '+ 새 에피소드 (승인된 컨셉에서)': '+ New episode (from approved concept)', '에피소드로 이동': 'Go to episode', '에피소드 복제': 'Duplicate episode', '에피소드 설정 저장': 'Save episode settings',
  '새 버전 에피소드로 대본 스튜디오 열기': 'Open Script Studio as a new episode version',
  // script studio
  'AI로 대본 만들기': 'Generate script with AI', 'AI로 대본 다시 만들기': 'Regenerate script with AI', 'AI로 다시 만들기': 'Regenerate with AI',
  'AI로 코미디 스토리 만들기 (PART A)': 'Generate comedy story with AI (PART A)', 'AI로 코미디 스토리 다시 만들기 (PART A)': 'Regenerate comedy story with AI (PART A)',
  'AI로 프롬프트 만들기': 'Generate prompts with AI', '초안 다시 만들기': 'Rebuild draft', '다시 만들기': 'Rebuild', '다시 생성': 'Regenerate',
  '대사 추가': 'Add line', '대사 삭제': 'Delete line', '대사 줄이기 (AI)': 'Shorten lines (AI)', '씬 저장': 'Save scene', '장면 저장': 'Save scene', '씬 승인': 'Approve scene', '씬 승인 취소': 'Revoke scene approval',
  '씬 추가': 'Add scene', '⎘ 씬 복제': 'Duplicate scene', '이 씬 삭제': 'Delete this scene', '이 단계에 씬 추가': 'Add scene to this step', '템플릿에서 씬 추가': 'Add scene from template',
  '← 이전 씬': '← Previous scene', '다음 씬 →': 'Next scene →', '변경 저장': 'Save changes', '저장 (새 버전)': 'Save (new version)', '새 버전으로 저장': 'Save as new version',
  '저장하고 계속 (승인은 되지 않습니다)': 'Save and continue (not approved)', '저장하지 않고 계속': 'Continue without saving',
  '+ 컷 추가': '+ Add cut', '컷 추가': 'Add cut', '컷 편집': 'Edit cut', '이 컷 삭제': 'Delete this cut',
  '번역 보기': 'Show translation', '번역 숨기기': 'Hide translation', '전체 프롬프트 보기': 'Show full prompt', '영상 마스터 프롬프트 복사': 'Copy video master prompt',
  '프롬프트 저장': 'Save prompt', '프롬프트 테스트': 'Test prompt', '프롬프트 수정됨': 'Prompt edited', '템플릿으로 만들기 (무료)': 'Build from template (free)',
  '템플릿으로 저장': 'Save as template', '템플릿 복제': 'Duplicate template', '템플릿 최신 버전 가져오기': 'Pull latest template', '다른 에피소드로 복사': 'Copy to another episode',
  '프리셋으로 저장': 'Save as preset', '프리셋 복제': 'Duplicate preset', '기본 프리셋으로 지정': 'Set as default preset', '새 에피소드 기본값으로 지정': 'Set as default for new episodes',
  '기본값 복원': 'Restore default', '기본값으로 복원': 'Restore default', '수정본 재승인': 'Re-approve edited version',
  '대본 스튜디오로 보내기': 'Send to Script Studio', '해당 입력칸으로 이동': 'Jump to field', '해당 장면으로 이동': 'Jump to scene',
  '전체 대본 승인 → 이미지 디벨롭': 'Approve full script → Image Development', '이미지 디벨롭 열기': 'Open Image Development', '이미지 디벨롭 열기 (대본이 바뀜 — 다시 이동 필요)': 'Open Image Development (script changed — re-send needed)',
  '스토리보드에서 열기': 'Open in Storyboard', '스토리보드에서 확인·승인': 'Review & approve in Storyboard', '제품 스튜디오에서 보기': 'View in Product Studio', 'Product Studio에서 보기': 'View in Product Studio',
  'Products에서 채우기': 'Fill in Products', 'Script Studio로 이동': 'Go to Script Studio', 'Story Lab에서 확인': 'Check in Story Lab',
  '모든 검사를 통과한 씬만 한꺼번에 승인합니다': 'Approve all passing scenes at once',
  // storyboard / image dev / video
  '시작 이미지 만들기': 'Create start image', '시작 이미지 다시 만들기': 'Recreate start image', '모든 장면 시작 이미지 만들기': 'Create all start images', '프레임 올리기': 'Upload frame', '이 프레임 승인': 'Approve this frame',
  '이미지 없이 진행…': 'Continue without image…', '비용 확인 후 생성 승인': 'Check cost, then approve generation', '같은 설정으로 다시 생성…': 'Regenerate with same settings…', '새로 생성…': 'Generate new…',
  '이 장면만 다시 생성 (새 승인 필요)': 'Regenerate only this scene (needs new approval)', '목업 생성 시작': 'Start mock generation', 'Google Flow 등에서 직접 만든 클립 올리기': 'Upload clip made in Google Flow etc.',
  '다음: ': 'Next: ', '모든 단계 완료': 'All steps done', '이 장면의 영상을 잘라 클로즈업 컷을 넣습니다 (요금 없음)': 'Crop this scene into a close-up cut (free)',
  // render / review / publishing
  '렌더로': 'To Render', '렌더링': 'Render', '미리보기 (540×960)': 'Preview (540×960)', '최종 렌더 (1080×1920)': 'Final render (1080×1920)', '게시 정보로': 'To Publishing info',
  '캡션 초안 만들기': 'Draft caption', '캡션·DM 승인': 'Approve caption & DM', '게시 완료로 기록': 'Mark as published',
  // settings
  '연결 테스트': 'Test connection', '키 저장': 'Save key', '키 삭제': 'Delete key', 'LIVE 켜기': 'Turn LIVE on', 'MOCK으로 되돌리기': 'Back to MOCK', '실제(LIVE) 모드 켜기…': 'Turn LIVE mode on…',
  '지출 한도': 'Spend limit', '채널 설정': 'Channel settings', '캐릭터 라이브러리': 'Character library', '제목 저장': 'Save title', '프롬프트 복사': 'Copy prompt',
  // misc
  '씬 다시 생성하기': 'Regenerate scene', '제안 적용': 'Apply proposal', '펼치기': 'Expand', '접기': 'Collapse',
  '캐릭터': 'Characters', '캐릭터 라이브러리': 'Character Library', '＋ 새 유니버스': 'New universe', '＋ 캐릭터 추가': 'Add character', '프로필 편집': 'Edit profile', '프로필 저장': 'Save profile', '유니버스 저장': 'Save universe', '활성화': 'Activate', '비활성화': 'Deactivate', '게스트 적용': 'Apply guest', '캐릭터 라이브러리 열기': 'Open Character Library', '엔딩 출연을 승인하고 만들기': 'Approve ending cast and create',
  '코드 저장': 'Save code',
  '클립보드에서 붙여넣기': 'Paste from clipboard', '사진 보관함 · 파일에서 선택': 'Choose from Photos / Files', '모두 지우기': 'Clear all', '자르기 적용': 'Apply crop', '초기화': 'Reset',
  '초안 저장': 'Save draft', '연결 테스트': 'Test connection', '토큰 저장': 'Save token', '연결 해제': 'Disconnect', 'ManyChat 열기': 'Open ManyChat', 'ManyChat 대시보드 열기': 'Open ManyChat', '설정 복사 (JSON)': 'Copy config (JSON)', '내보내기': 'Export', 'ManyChat 설정 단계로 넘기기': 'Move to ManyChat setup', '설정 안내 보기 · 설정 복사': 'Guided setup', 'ManyChat 설정 완료 기록': 'Mark configured in ManyChat', '검증 기록 남기기 (테스트 완료)': 'Record verification', '설정 단계로 되돌리기': 'Reopen setup', '실패로 기록': 'Mark failed', '캠페인 기록 보관': 'Archive campaign', '활성으로 기록': 'Record as active', '실패 기록': 'Record failure', '변경하고 다시 검증': 'Change and re-verify', '설정 완료로 기록': 'Record as configured', '확인했고 돌리기': 'Confirm and reopen', '해제': 'Disconnect', '보관': 'Archive',
  '보고서 가져오기 (CSV/XLSX)': 'Import report (CSV/XLSX)', '필터 해제': 'Clear filter', '가져오기': 'Import', '스토리랩에서 시작하기': 'Start in Story Lab',
  '스토리 만들기 →': 'Create story →',
  '스토리보드로 이동': 'Go to Storyboard', '스토리보드 열기': 'Open Storyboard',
  '제목 수정': 'Edit title', '에피소드 보류': 'Hold episode', '이어서 작업': 'Resume work',
  '스토리 승인': 'Approve story', '보류': 'Hold', '보류 해제': 'Resume', '삭제 취소 (복원)': 'Undo delete (restore)', '고급 설정': 'Advanced settings', '자세히 보기': 'Details', '수정본 재승인': 'Re-approve edited version',
  '한국어 번역': 'Korean translation', '스토리 승인 →': 'Approve story →', '수정': 'Edit', '전체 현황 보기': 'Show full status',
  '에피소드 복제': 'Duplicate episode', '에피소드 보관': 'Archive episode', '보관 해제': 'Unarchive', '대본 버전 관리': 'Manage script versions', '에피소드 삭제': 'Delete episode',
  '이 버전 삭제': 'Delete this version', '삭제 취소 (복원)': 'Undo delete (restore)', '버전 삭제': 'Delete version', '휴지통으로 이동': 'Move to trash', '삭제한 버전 포함 모두 보기': 'Show all, including deleted', '복제': 'Duplicate',
  '홈': 'Home', '자동 DM': 'Auto-DM', 'API 연결': 'API connections', '자동 DM 스튜디오': 'Auto-DM Studio', '제품': 'Products', '애니메이션': 'Animation', '캐릭터': 'Characters', '엔딩 템플릿': 'Ending templates', '프롬프트 매니저': 'Prompt manager', 'AI 프롬프트 관리': 'Manage AI prompts', 'AI 연동': 'AI connections',
  '일반 · 비용': 'General · Cost', '사용량 · 한도': 'Usage · Limits', '음성 생성': 'Generate voice', '효과음 추가': 'Add sound effect', '음성 확인 (HeyGen 목록 조회)': 'Check voices (HeyGen list)',
  '목록으로': 'Back to list', '휴지통': 'Trash', '휴지통 보기': 'View trash', '휴지통 닫기': 'Close trash', '복제': 'Duplicate', '새 버전': 'New version',
};

// Dynamic labels (counts, ids, versions): [pattern, english builder]
export const RULES = [
  [/^추천 ([A-Z0-9]+) 사용$/, (m) => `Use suggested ${m[1]}`],
  [/^(\d+)장 저장$/, (m) => `Save ${m[1]} image(s)`],
  [/^비교 \((\d+)\)$/, (m) => `Compare (${m[1]})`],
  [/^고쳐야 할 항목 (\d+)개$/, (m) => `${m[1]} items to fix`],
  [/^장면을 (\d+)초로 늘리기$/, (m) => `Extend scene to ${m[1]}s`],
  [/^승인된 이미지 (\d+)장을 참조 세트로 승인$/, (m) => `Approve ${m[1]} approved image(s) as reference set`],
  [/^후보·승인 (\d+)$/, (m) => `Candidates · Approved ${m[1]}`],
  [/^거절\(보관\) (\d+)$/, (m) => `Rejected (kept) ${m[1]}`],
  [/^교체됨 (\d+)$/, (m) => `Replaced ${m[1]}`],
  [/^승인 가능한 씬 모두 승인 \((\d+)\)$/, (m) => `Approve all ready scenes (${m[1]})`],
  [/^제안: “/, () => 'Add suggested line'],
  [/^장면을 ([\d.]+)초로 늘리기$/, (m) => `Extend scene to ${m[1]}s`],
  [/^넘치는 장면 (\d+)개 대사 줄이기 \(AI\)$/, (m) => `Shorten lines in ${m[1]} overflowing scene(s) (AI)`],
  [/^v(\d+)로 복원$/, (m) => `Restore v${m[1]}`],
  [/^(\S+) 씬 (?:열기|이동)$/, (m) => `Open scene ${m[1]}`],
  [/^다음: (.+)$/, (m) => `Next: ${m[1]}`],
  [/^(.+) 키 (삭제|저장)$/, (m) => (m[2] === '삭제' ? 'Delete key' : 'Save key')],
  [/^(.+) 열기$/, () => 'Open'],
];

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export function enFor(label) {
  const t = norm(label);
  if (!t || !/[가-힣]/.test(t)) return '';
  if (EN[t]) return EN[t];
  const c = norm(t.replace(/^[✎✓↻⚠○·\s]+/, '').replace(/[✓⚠↻]+$/, ''));
  if (EN[c]) return EN[c];
  for (const [re, fn] of RULES) { const m = c.match(re); if (m) return fn(m); }
  return '';
}
