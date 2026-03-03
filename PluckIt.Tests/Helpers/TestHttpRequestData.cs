using System.Net;
using System.Security.Claims;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Moq;

namespace PluckIt.Tests.Helpers;

/// <summary>
/// Concrete <see cref="HttpResponseData"/> for use in unit tests.
/// Captures status, headers, and body written by function handlers.
/// </summary>
public sealed class TestHttpResponseData : HttpResponseData
{
    public TestHttpResponseData(FunctionContext context, HttpStatusCode statusCode = HttpStatusCode.OK)
        : base(context)
    {
        StatusCode = statusCode;
        Headers    = new HttpHeadersCollection();
        Body       = new MemoryStream();
    }

    public override HttpStatusCode StatusCode { get; set; }
    public override HttpHeadersCollection Headers { get; set; }
    public override Stream Body { get; set; }
    public override HttpCookies Cookies => throw new NotImplementedException();

    /// <summary>Reads the response body as a UTF-8 string after rewinding the stream.</summary>
    public string ReadBodyAsString()
    {
        Body.Position = 0;
        return new StreamReader(Body).ReadToEnd();
    }
}

/// <summary>
/// Concrete <see cref="HttpRequestData"/> for use in unit tests.
/// Supports GET/POST/PUT/PATCH/DELETE with an optional body and custom headers.
/// Auth bypass: include no Authorization header and set <c>Local:DevUserId</c> in the
/// <see cref="Microsoft.Extensions.Configuration.IConfiguration"/> passed to the function.
/// </summary>
public sealed class TestHttpRequestData : HttpRequestData
{
    private readonly FunctionContext _context;

    public TestHttpRequestData(
        FunctionContext context,
        HttpMethod? method  = null,
        string      url     = "http://localhost/api/test",
        Stream?     body    = null,
        Dictionary<string, string>? headers = null)
        : base(context)
    {
        _context = context;
        Method   = (method ?? HttpMethod.Get).Method;
        Url      = new Uri(url);
        Body     = body ?? Stream.Null;

        Headers = new HttpHeadersCollection();
        if (headers is not null)
        {
            foreach (var (k, v) in headers)
                Headers.Add(k, v);
        }
    }

    public override Stream Body { get; }
    public override HttpHeadersCollection Headers { get; }
    public override IReadOnlyCollection<IHttpCookie> Cookies => Array.Empty<IHttpCookie>();
    public override Uri Url { get; }
    public override IEnumerable<ClaimsIdentity> Identities => Enumerable.Empty<ClaimsIdentity>();
    public override string Method { get; }

    public override HttpResponseData CreateResponse()
        => new TestHttpResponseData(_context);
}

/// <summary>
/// Factory that creates a <see cref="TestHttpRequestData"/> backed by a mocked
/// <see cref="FunctionContext"/>. Keeps call-sites concise.
/// </summary>
public static class TestRequest
{
    private static FunctionContext CreateMockContext()
        => new Mock<FunctionContext>().Object;

    /// <summary>GET request against <paramref name="url"/>.</summary>
    public static TestHttpRequestData Get(string url = "http://localhost/api/test")
        => new(CreateMockContext(), HttpMethod.Get, url);

    /// <summary>POST request with a JSON body.</summary>
    public static TestHttpRequestData Post(string url, string jsonBody)
    {
        var body = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(jsonBody));
        return new TestHttpRequestData(CreateMockContext(), HttpMethod.Post, url, body,
            new Dictionary<string, string> { ["Content-Type"] = "application/json" });
    }

    /// <summary>PUT request with a JSON body.</summary>
    public static TestHttpRequestData Put(string url, string jsonBody)
    {
        var body = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(jsonBody));
        return new TestHttpRequestData(CreateMockContext(), HttpMethod.Put, url, body,
            new Dictionary<string, string> { ["Content-Type"] = "application/json" });
    }

    /// <summary>PATCH request (no body).</summary>
    public static TestHttpRequestData Patch(string url)
        => new(CreateMockContext(), HttpMethod.Patch, url);

    /// <summary>PATCH request with a JSON body.</summary>
    public static TestHttpRequestData Patch(string url, string jsonBody)
    {
        var body = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(jsonBody));
        return new TestHttpRequestData(CreateMockContext(), HttpMethod.Patch, url, body,
            new Dictionary<string, string> { ["Content-Type"] = "application/json" });
    }

    /// <summary>DELETE request.</summary>
    public static TestHttpRequestData Delete(string url)
        => new(CreateMockContext(), HttpMethod.Delete, url);
}
