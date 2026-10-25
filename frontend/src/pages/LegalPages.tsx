import React from "react";
import { Box, Link, Paper, Typography } from "@mui/material";
import {
  Description as DescriptionIcon,
  Mail as MailIcon,
  PrivacyTip as PrivacyTipIcon,
  GitHub as GitHubIcon,
} from "@mui/icons-material";
import { usePageTitle } from "../hooks/usePageTitle";

// お問い合わせ・データ削除の依頼先（GitHub リポジトリの Issues）
export const ISSUES_URL = "https://github.com/0xItoHub/Engineer_English_App/issues";

// プライバシーポリシーの最終更新日
const PRIVACY_UPDATED_AT = "2026年10月25日";

type LayoutProps = {
  title: string;
  Icon: typeof DescriptionIcon;
  children: React.ReactNode;
};

// 規約・ポリシーなどの文章ページの共通レイアウト
const LegalLayout: React.FC<LayoutProps> = ({ title, Icon, children }) => {
  usePageTitle(title);
  return (
    <Paper elevation={1} component="article" sx={{ p: { xs: 2.5, sm: 4 }, maxWidth: 860, mx: "auto" }}>
      <Typography variant="h4" component="h1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: { xs: "1.625rem", sm: "2.125rem" } }}>
        <Icon color="primary" fontSize="large" aria-hidden="true" />
        {title}
      </Typography>
      <Box
        sx={{
          "& h2": { mt: 4, mb: 1 },
          "& p, & li": { lineHeight: 1.9 },
          "& ul": { pl: 3, my: 1 },
        }}
      >
        {children}
      </Box>
    </Paper>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box component="section">
    <Typography variant="h6" component="h2">
      {title}
    </Typography>
    {children}
  </Box>
);

// 外部のリンク（新しいタブで開く）
const IssuesLink: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <Link href={ISSUES_URL} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
    <GitHubIcon fontSize="small" aria-hidden="true" />
    {children ?? "GitHub リポジトリの Issues"}
    <Box component="span" sx={{ fontSize: "0.8125rem", color: "text.secondary" }}>
      （新しいタブで開きます）
    </Box>
  </Link>
);

export const PrivacyPolicy: React.FC = () => (
  <LegalLayout title="プライバシーポリシー" Icon={PrivacyTipIcon}>
    <Typography variant="body1">
      Engineer English App（以下「本サービス」）は、個人が開発・運営する英語学習サービスです。本サービスで取り扱う情報と、その利用目的は次のとおりです。
    </Typography>

    <Section title="1. 取得する情報">
      <ul>
        <li>
          <strong>メールアドレス</strong>: ログイン（Amazon Cognito による認証）のために登録・利用します。
        </li>
        <li>
          <strong>学習の記録</strong>: ログイン中に完了したレッスンについて、レッスンの ID・完了日時・学習時間を保存します。
        </li>
      </ul>
      <Typography variant="body1">
        これらの情報は、Amazon Web Services（AWS）の東京リージョンに保存します。
      </Typography>
    </Section>

    <Section title="2. ブラウザへの保存">
      <Typography variant="body1">本サービスは、お使いのブラウザに次の情報を保存します。</Typography>
      <ul>
        <li>ログインしていないときの学習の記録（ログイン後にアカウントへ反映します）</li>
        <li>ログイン状態を保つための情報（タブを閉じると破棄されます）</li>
        <li>読み上げ速度などの表示の設定</li>
      </ul>
    </Section>

    <Section title="3. 利用目的">
      <Typography variant="body1">
        取得した情報は、ログインと学習の記録の保存・表示など、本サービスの学習機能を提供するためにのみ利用します。
      </Typography>
    </Section>

    <Section title="4. 第三者への提供">
      <Typography variant="body1">
        取得した情報を販売したり、第三者に提供したりすることはありません。ただし、本サービスの運営に必要な範囲で、AWS のクラウドサービス上で情報を処理・保存します。
      </Typography>
    </Section>

    <Section title="5. アカウント・データの削除">
      <Typography variant="body1">
        アカウントや学習の記録の削除を希望される場合は、<IssuesLink />からご連絡ください。Issues は公開されるため、メールアドレスなどの個人情報は書き込まないでください。対応の方法は Issue 上でご案内します。
      </Typography>
      <Typography variant="body1">
        ブラウザに保存された情報は、ブラウザのサイトデータを削除することで消去できます。
      </Typography>
    </Section>

    <Section title="6. 改定">
      <Typography variant="body1">本ポリシーは必要に応じて改定し、このページで公開します。</Typography>
    </Section>

    <Typography variant="body2" color="text.secondary" sx={{ mt: 4 }}>
      最終更新日: {PRIVACY_UPDATED_AT}
    </Typography>
  </LegalLayout>
);

export const Terms: React.FC = () => (
  <LegalLayout title="利用規約" Icon={DescriptionIcon}>
    <Typography variant="body1">
      本規約は、Engineer English App（以下「本サービス」）の利用条件を定めるものです。本サービスを利用した時点で、本規約に同意したものとみなします。
    </Typography>

    <Section title="1. 本サービスについて">
      <Typography variant="body1">
        本サービスは、個人が開発したポートフォリオ（デモ）として公開している英語学習サービスです。
      </Typography>
    </Section>

    <Section title="2. 無保証">
      <Typography variant="body1">
        本サービスは現状のまま提供します。内容の正確性・完全性や、継続して利用できることを保証するものではありません。本サービスの利用によって生じた損害について、運営者は責任を負いません。
      </Typography>
    </Section>

    <Section title="3. 変更・停止">
      <Typography variant="body1">
        本サービスの内容は、予告なく変更・中断・終了する場合があります。学習の記録が保持されない場合もあります。
      </Typography>
    </Section>

    <Section title="4. 禁止事項">
      <ul>
        <li>不正アクセスや、サーバーに過度な負荷をかける行為</li>
        <li>本サービスの運営を妨げる行為</li>
        <li>法令や公序良俗に反する行為、他者の権利を侵害する行為</li>
      </ul>
    </Section>

    <Section title="5. 規約の変更">
      <Typography variant="body1">本規約は必要に応じて変更し、このページで公開します。</Typography>
    </Section>
  </LegalLayout>
);

export const Contact: React.FC = () => (
  <LegalLayout title="お問い合わせ" Icon={MailIcon}>
    <Typography variant="body1">
      本サービスへのご意見・ご要望や、アカウントの削除のご依頼は、<IssuesLink />で受け付けています。
    </Typography>
    <Typography variant="body1" sx={{ mt: 2 }}>
      Issues は公開されるため、メールアドレスなどの個人情報は書き込まないでください。
    </Typography>
  </LegalLayout>
);
