// 电商整组重试与复制任务。
//
// 硬约束（继承 10-11 设计文档与 pr(1) 纪律）：
//   - 重试必须显式 confirmCost=true（重新出图会再次计费）；
//   - running / uncertain 状态的商品**拒绝重发**（在途或结果未知，重发会重复扣费）；
//   - 重试走 round+1 新轮次，旧轮次槽位与版本全部保留（不覆盖历史）；
//   - 复制只拷贝商品元信息，不带槽位/版本，status=draft 等用户再次触发。
package app

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// EcommerceRetryResult 整组重试结果。
type EcommerceRetryResult struct {
	Retried []string          `json:"retried"`
	Refused map[string]string `json:"refused"`
}

// RetryEcommerceProducts 整组重试：round+1、清空旧槽位视图、按最新配置重新编排。
//
// 只重置「槽位与版本」的编排状态，不物理删除历史数据——旧轮次仍可通过 round 区分。
func (s *Service) RetryEcommerceProducts(userID string, productIDs []string, confirmCost bool) (*EcommerceRetryResult, error) {
	if !confirmCost {
		return nil, NewAppError(http.StatusBadRequest, "整组重试会重新生成并计费，需确认（confirmCost=true）")
	}
	if len(productIDs) == 0 {
		return nil, NewAppError(http.StatusBadRequest, "请先选择要重试的商品任务")
	}
	result := &EcommerceRetryResult{Retried: make([]string, 0, len(productIDs)), Refused: map[string]string{}}
	for _, rawID := range productIDs {
		productID := strings.TrimSpace(rawID)
		if productID == "" {
			continue
		}
		product, err := s.repo.GetEcommerceProduct(userID, productID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				result.Refused[productID] = "商品任务不存在"
				continue
			}
			return nil, err
		}
		// 在途或结果未知：拒绝重发（避免重复计费）。
		if product.Status == ecommerce.ProductStatusRunning || product.Status == ecommerce.ProductStatusUncertain {
			result.Refused[productID] = "当前状态为 " + product.Status + "，请等待收尾后再重试"
			continue
		}
		if err := s.repo.ResetEcommerceProductForRetry(userID, productID, product.Round+1); err != nil {
			return nil, err
		}
		result.Retried = append(result.Retried, productID)
	}
	if len(result.Retried) == 0 {
		return result, NewAppError(http.StatusConflict, "所选任务均不可重试（在途/待确认或不存在）")
	}
	return result, nil
}

// DuplicateEcommerceProduct 复制任务：只拷贝商品元信息，不带槽位与历史。
func (s *Service) DuplicateEcommerceProduct(userID, productID string) (*model.EcommerceProduct, error) {
	source, err := s.repo.GetEcommerceProduct(userID, productID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("商品任务不存在")
		}
		return nil, err
	}
	now := time.Now()
	// 名称加「副本」后缀，避免列表里无法区分。
	name := strings.TrimSpace(source.Name) + " · 副本"
	if len([]rune(name)) > 120 {
		name = string([]rune(name)[:120])
	}
	duplicate := &model.EcommerceProduct{
		ID:                 kernel.NewID(),
		UserID:             userID,
		Name:               name,
		Round:              1,
		SourceResourceID:   source.SourceResourceID,
		SourceName:         source.SourceName,
		SellingPoints:      source.SellingPoints,
		ExtraRequirements:  source.ExtraRequirements,
		Status:             ecommerce.ProductStatusDraft,
		ConfigSnapshotJSON: source.ConfigSnapshotJSON,
		TitleStatus:        "pending",
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if err := s.repo.CreateEcommerceProduct(duplicate); err != nil {
		return nil, err
	}
	return duplicate, nil
}
