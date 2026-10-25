import React from "react";
import { Link as RouterLink } from "react-router";
import { Box, Button, Paper, Typography } from "@mui/material";
import { History as HistoryIcon, PlayArrow as PlayIcon } from "@mui/icons-material";
import type { Scene } from "../lib/queries";
import { readLastLesson } from "../lib/storage";

type Props = {
  scenes: Scene[];
};

// 最後に開いたレッスンへの導線（「続きから」）
// 教材の一覧に無いレッスン（削除済みなど）の記録は表示しない
const ContinueLearning: React.FC<Props> = ({ scenes }) => {
  const [last] = React.useState(readLastLesson);
  if (!last) return null;
  const scene = scenes.find((s) => s.id === last.scene);
  const lesson = scene?.lessons?.find((l) => l.id === last.lesson);
  if (!scene || !lesson) return null;

  return (
    <Paper
      component="section"
      aria-labelledby="continue-learning-title"
      elevation={2}
      sx={{ p: { xs: 2, sm: 2.5 }, mb: 4, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 2 }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          id="continue-learning-title"
          variant="subtitle1"
          component="h2"
          sx={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 1 }}
        >
          <HistoryIcon color="primary" aria-hidden="true" />
          続きから
        </Typography>
        <Typography variant="body1" sx={{ mt: 0.5, overflowWrap: "anywhere" }}>
          {lesson.title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {scene.title}
        </Typography>
      </Box>
      <Button
        component={RouterLink}
        to={`/lesson/${lesson.id}`}
        variant="contained"
        startIcon={<PlayIcon />}
        aria-label={`${lesson.title} を続きから学習する`}
        sx={{ minHeight: 44, whiteSpace: "nowrap" }}
      >
        続きから学習する
      </Button>
    </Paper>
  );
};

export default ContinueLearning;
