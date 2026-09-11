<script setup lang="ts">
/**
 * 訪客才看得到的提示條。**不能關掉**：忘了綁定的後果是資料永久遺失，
 * 而提示條只要綁定成功就會自己消失。
 *
 * 綁定本身在個人頁做，這裡只負責把人帶過去 —— 綁定與合併的流程只寫一份。
 */
import { RouterLink } from "vue-router";
</script>

<template>
  <div class="card flat guest-banner">
    <p class="tiny">目前是訪客，資料只存在這台裝置。綁定帳號才不會遺失。</p>
    <RouterLink to="/profile" class="btn btn-primary">綁定</RouterLink>
  </div>
</template>

<style scoped>
.guest-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.guest-banner p {
  margin: 0;
}
</style>
