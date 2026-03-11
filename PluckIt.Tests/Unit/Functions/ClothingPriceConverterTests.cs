using System;
using System.Text.Json;
using Shouldly;
using PluckIt.Core;
using PluckIt.Functions.Serialization;
using Xunit;

namespace PluckIt.Tests.Unit.Functions;

/// <summary>
/// Unit tests for <see cref="ClothingPriceConverter"/>.
/// The converter handles two on-disk shapes:
///   - Legacy: a bare JSON number (e.g. 49.99)
///   - Current: a JSON object with amount, originalCurrency, and optional purchaseDate
/// </summary>
[Trait("Category", "Unit")]
public sealed class ClothingPriceConverterTests
{
    private static readonly JsonSerializerOptions _opts = new()
    {
        Converters = { new ClothingPriceConverter() }
    };

    // ── Read: legacy number format ────────────────────────────────────────────

    [Fact]
    public void Read_LegacyNumberFormat_ReturnsCorrectAmount()
    {
        var result = JsonSerializer.Deserialize<ClothingPrice>("99.99", _opts);

        result.ShouldNotBeNull();
        result!.Amount.ShouldBe(99.99m);
    }

    [Fact]
    public void Read_LegacyNumberFormat_DefaultsOriginalCurrencyToUsd()
    {
        var result = JsonSerializer.Deserialize<ClothingPrice>("49", _opts);

        result!.OriginalCurrency.ShouldBe("USD");
    }

    [Fact]
    public void Read_LegacyNumberFormat_PurchaseDateIsNull()
    {
        var result = JsonSerializer.Deserialize<ClothingPrice>("0.00", _opts);

        result!.PurchaseDate.ShouldBeNull();
    }

    // ── Read: object format ───────────────────────────────────────────────────

    [Fact]
    public void Read_ObjectFormat_AllFields_Roundtrips()
    {
        const string json = """{"amount":129.95,"originalCurrency":"GBP","purchaseDate":"2024-11-01"}""";

        var result = JsonSerializer.Deserialize<ClothingPrice>(json, _opts);

        result.ShouldNotBeNull();
        result!.Amount.ShouldBe(129.95m);
        result.OriginalCurrency.ShouldBe("GBP");
        result.PurchaseDate.ShouldBe("2024-11-01");
    }

    [Fact]
    public void Read_ObjectFormat_NullOriginalCurrency_DefaultsToUsd()
    {
        const string json = """{"amount":50.00,"originalCurrency":null}""";

        var result = JsonSerializer.Deserialize<ClothingPrice>(json, _opts);

        result!.OriginalCurrency.ShouldBe("USD");
    }

    [Fact]
    public void Read_ObjectFormat_MissingPurchaseDate_IsNull()
    {
        const string json = """{"amount":25.00,"originalCurrency":"EUR"}""";

        var result = JsonSerializer.Deserialize<ClothingPrice>(json, _opts);

        result!.PurchaseDate.ShouldBeNull();
    }

    [Fact]
    public void Read_ObjectFormat_NullPurchaseDate_IsNull()
    {
        const string json = """{"amount":25.00,"originalCurrency":"EUR","purchaseDate":null}""";

        var result = JsonSerializer.Deserialize<ClothingPrice>(json, _opts);

        result!.PurchaseDate.ShouldBeNull();
    }

    [Fact]
    public void Read_ObjectFormat_CaseInsensitivePropertyNames()
    {
        // Cosmos sometimes returns capitalised keys
        const string json = """{"Amount":75.00,"OriginalCurrency":"CAD","PurchaseDate":"2025-01-15"}""";

        var result = JsonSerializer.Deserialize<ClothingPrice>(json, _opts);

        result!.Amount.ShouldBe(75.00m);
        result.OriginalCurrency.ShouldBe("CAD");
        result.PurchaseDate.ShouldBe("2025-01-15");
    }

    [Fact]
    public void Read_ObjectFormat_UnknownPropertyIgnored()
    {
        const string json = """{"amount":10.00,"originalCurrency":"USD","unknown":"ignored","extra":42}""";

        var result = JsonSerializer.Deserialize<ClothingPrice>(json, _opts);

        result!.Amount.ShouldBe(10.00m);
    }

    [Fact]
    public void Read_ObjectFormat_ZeroAmount()
    {
        const string json = """{"amount":0,"originalCurrency":"USD"}""";

        var result = JsonSerializer.Deserialize<ClothingPrice>(json, _opts);

        result!.Amount.ShouldBe(0m);
    }

    // ── Read: error case ──────────────────────────────────────────────────────

    [Fact]
    public void Read_StringToken_ThrowsJsonException()
    {
        Should.Throw<JsonException>(() =>
            JsonSerializer.Deserialize<ClothingPrice>("\"not-a-number\"", _opts));
    }

    [Fact]
    public void Read_BooleanToken_ThrowsJsonException()
    {
        Should.Throw<JsonException>(() =>
            JsonSerializer.Deserialize<ClothingPrice>("true", _opts));
    }

    // ── Write ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Write_ProducesObjectWithAmountAndCurrency()
    {
        var price = new ClothingPrice { Amount = 55.00m, OriginalCurrency = "EUR" };

        var json = JsonSerializer.Serialize(price, _opts);

        // Must be parseable and contain the right properties
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        root.TryGetProperty("amount", out var amt).ShouldBeTrue();
        amt.GetDecimal().ShouldBe(55.00m);
        root.TryGetProperty("originalCurrency", out var curr).ShouldBeTrue();
        curr.GetString().ShouldBe("EUR");
    }

    [Fact]
    public void Write_OmitsPurchaseDateWhenNull()
    {
        var price = new ClothingPrice { Amount = 10m, OriginalCurrency = "USD", PurchaseDate = null };

        var json = JsonSerializer.Serialize(price, _opts);

        using var doc = JsonDocument.Parse(json);
        doc.RootElement.TryGetProperty("purchaseDate", out _).ShouldBeFalse();
    }

    [Fact]
    public void Write_IncludesPurchaseDateWhenSet()
    {
        var price = new ClothingPrice { Amount = 10m, OriginalCurrency = "USD", PurchaseDate = "2025-06-01" };

        var json = JsonSerializer.Serialize(price, _opts);

        using var doc = JsonDocument.Parse(json);
        doc.RootElement.TryGetProperty("purchaseDate", out var d).ShouldBeTrue();
        d.GetString().ShouldBe("2025-06-01");
    }

    // ── Round-trip ────────────────────────────────────────────────────────────

    [Fact]
    public void RoundTrip_LegacyNumber_WritesObjectFormat_ThenReadsBack()
    {
        // Simulate reading a legacy document (bare number)
        var fromLegacy = JsonSerializer.Deserialize<ClothingPrice>("199.99", _opts)!;

        // Then write it (should produce object format)
        var written = JsonSerializer.Serialize(fromLegacy, _opts);

        // And read it back
        var roundTripped = JsonSerializer.Deserialize<ClothingPrice>(written, _opts);

        roundTripped!.Amount.ShouldBe(199.99m);
        roundTripped.OriginalCurrency.ShouldBe("USD");
    }

    [Fact]
    public void RoundTrip_FullObject_PreservesAllFields()
    {
        var original = new ClothingPrice
        {
            Amount = 350.00m,
            OriginalCurrency = "JPY",
            PurchaseDate = "2023-12-25"
        };

        var json = JsonSerializer.Serialize(original, _opts);
        var restored = JsonSerializer.Deserialize<ClothingPrice>(json, _opts);

        restored!.Amount.ShouldBe(350.00m);
        restored.OriginalCurrency.ShouldBe("JPY");
        restored.PurchaseDate.ShouldBe("2023-12-25");
    }
}
