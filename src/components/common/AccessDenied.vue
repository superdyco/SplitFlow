<script setup lang="ts">
import { RouterLink } from "vue-router";

withDefaults(
  defineProps<{
    title?: string;
    message?: string;
  }>(),
  {
    title: "你沒有這個分帳任務的權限",
    message: "可能是還沒加入、邀請連結已停用，或是已經被移出這個任務。"
  }
);
</script>

<template>
  <div class="card denied stack">
    <span class="mark" aria-hidden="true">🔒</span>
    <h1 class="section-title">{{ title }}</h1>
    <p class="tiny">{{ message }}</p>
    <p class="tiny">
      如果你認為這是誤判，請向任務的建立者要一份新的邀請連結。
      加入之後這個頁面就會正常顯示。
    </p>
    <RouterLink to="/tasks" class="btn btn-primary btn-block">回我的分帳</RouterLink>
  </div>
</template>

<style scoped>
.denied {
  text-align: center;
  align-items: center;
}

.mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  font-size: 26px;
}

.denied .tiny {
  margin: 0;
  max-width: 34em;
}

.denied .btn {
  margin-top: 6px;
}
</style>
