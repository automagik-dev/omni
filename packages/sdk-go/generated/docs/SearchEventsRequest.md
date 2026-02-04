# SearchEventsRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Query** | Pointer to **string** | Full-text search query | [optional] 
**Filters** | Pointer to [**SearchEventsRequestFilters**](SearchEventsRequestFilters.md) |  | [optional] 
**Format** | Pointer to **string** | Response format | [optional] [default to "full"]
**Limit** | Pointer to **int32** | Max results | [optional] [default to 50]

## Methods

### NewSearchEventsRequest

`func NewSearchEventsRequest() *SearchEventsRequest`

NewSearchEventsRequest instantiates a new SearchEventsRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSearchEventsRequestWithDefaults

`func NewSearchEventsRequestWithDefaults() *SearchEventsRequest`

NewSearchEventsRequestWithDefaults instantiates a new SearchEventsRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetQuery

`func (o *SearchEventsRequest) GetQuery() string`

GetQuery returns the Query field if non-nil, zero value otherwise.

### GetQueryOk

`func (o *SearchEventsRequest) GetQueryOk() (*string, bool)`

GetQueryOk returns a tuple with the Query field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetQuery

`func (o *SearchEventsRequest) SetQuery(v string)`

SetQuery sets Query field to given value.

### HasQuery

`func (o *SearchEventsRequest) HasQuery() bool`

HasQuery returns a boolean if a field has been set.

### GetFilters

`func (o *SearchEventsRequest) GetFilters() SearchEventsRequestFilters`

GetFilters returns the Filters field if non-nil, zero value otherwise.

### GetFiltersOk

`func (o *SearchEventsRequest) GetFiltersOk() (*SearchEventsRequestFilters, bool)`

GetFiltersOk returns a tuple with the Filters field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetFilters

`func (o *SearchEventsRequest) SetFilters(v SearchEventsRequestFilters)`

SetFilters sets Filters field to given value.

### HasFilters

`func (o *SearchEventsRequest) HasFilters() bool`

HasFilters returns a boolean if a field has been set.

### GetFormat

`func (o *SearchEventsRequest) GetFormat() string`

GetFormat returns the Format field if non-nil, zero value otherwise.

### GetFormatOk

`func (o *SearchEventsRequest) GetFormatOk() (*string, bool)`

GetFormatOk returns a tuple with the Format field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetFormat

`func (o *SearchEventsRequest) SetFormat(v string)`

SetFormat sets Format field to given value.

### HasFormat

`func (o *SearchEventsRequest) HasFormat() bool`

HasFormat returns a boolean if a field has been set.

### GetLimit

`func (o *SearchEventsRequest) GetLimit() int32`

GetLimit returns the Limit field if non-nil, zero value otherwise.

### GetLimitOk

`func (o *SearchEventsRequest) GetLimitOk() (*int32, bool)`

GetLimitOk returns a tuple with the Limit field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLimit

`func (o *SearchEventsRequest) SetLimit(v int32)`

SetLimit sets Limit field to given value.

### HasLimit

`func (o *SearchEventsRequest) HasLimit() bool`

HasLimit returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


