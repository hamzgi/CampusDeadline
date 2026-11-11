# 중부대 과제 체크보드 — Next.js 버전

기존 대시보드의 화면과 JavaScript를 유지하면서 Next.js App Router로 제공한다. Canvas 조회는 기존 브라우저 확장프로그램에서 수행하며 서버가 LMS 계정 정보나 과제 데이터를 저장하지 않는다.

```sh
npm ci
npm run dev
```

Vercel 프로젝트에 연결한 후 `vercel --prod`로 배포한다. 대시보드에서 받는 확장프로그램 ZIP은 요청한 대시보드 주소를 포함하도록 만들어지며, 기존 Sites 주소도 계속 지원한다. 새로운 주소에 맞춘 확장프로그램은 한 번 다시 설치하거나 압축 해제한 확장프로그램을 다시 로드해야 한다.

브라우저의 로컬 저장소는 주소별로 분리되므로 새 주소에서 LMS 과제를 다시 동기화해야 한다. 기존 주소에서 수동으로 추가한 과제는 자동으로 옮겨지지 않는다.

## 1단계: Google 로그인과 계정 보안

로그인 연결이 설정되지 않은 동안에는 기존 비로그인 대시보드가 그대로 동작한다. 설정 후에는 Google 로그인과 로그아웃을 사용할 수 있으며, 학교 이메일 제한은 없다. 이 단계에서 과제는 여전히 이 기기의 브라우저에 저장되고, 휴대폰과 과제 데이터를 공유하는 기능은 다음 단계에서 구현한다. 브라우저 저장소의 계정별 화면 분리는 공용 기기에서 데이터를 보호하는 보안 경계가 아니다.

실제 인증을 사용하려면 다음 설정이 필요하다.

1. 선택한 Supabase 조직에 프로젝트를 만들고 `supabase/migrations/20261111005109_account_profiles.sql`을 적용한다. 이 테이블은 로그인 사용자의 본인 행만 읽고 만들도록 RLS를 적용한다.
2. Google Cloud의 OAuth 동의 화면과 웹 클라이언트를 만들고 Supabase Auth의 Google 공급자를 설정한다. Google에 등록할 콜백 주소는 Supabase의 Google 공급자 화면에서 확인한다. 서비스 로그인과 학교 LMS 로그인은 별개다.
3. Supabase의 Site URL과 허용된 리디렉션 주소에 실제 대시보드 주소와 `/auth/callback`을 설정한다. 운영과 테스트의 Google·Supabase 설정은 분리한다.
4. 서버 환경에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APP_BASE_URL`을 설정한다. `.env.example`을 참고하되 이미 존재하는 `.env.local`은 덮어쓰지 않는다. `APP_BASE_URL`은 해당 환경의 정확한 HTTPS 출처여야 한다(로컬 개발은 localhost HTTP 허용).
5. Google Client Secret은 Supabase 공급자 설정에만 입력하고 채팅, 저장소, 브라우저 코드에 넣지 않는다. Supabase 관리용 secret/service-role 키도 브라우저에 노출하지 않는다.

로그인한 계정에서 LMS 과제를 받으려면 대시보드의 동기화 창을 먼저 연 뒤, LMS 탭에서 확장프로그램 동기화를 실행한다. 과거 확장프로그램 결과가 다른 로그인 계정에 자동으로 반영되지 않도록 하기 위한 절차다.

검증 명령:

```sh
npm run build
npm run test:auth-server
npm run test:rls
# 별도 터미널에서 npm run start -- -p 3147 실행 후:
npm run test:auth-ui
npm run test:smoke
npm run test:extension
```

인증 서버 테스트는 모의 Supabase, RLS 테스트는 메모리 내 PostgreSQL을 사용한다. 실제 Google 로그인과 실제 Supabase의 정책·설정 검증을 대신하지 않는다.
