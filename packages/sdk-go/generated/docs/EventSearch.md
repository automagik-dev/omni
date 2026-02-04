# EventSearch

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Query** | Pointer to **string** | Full-text search query | [optional] 
**Filters** | Pointer to [**SearchEventsRequestFilters**](SearchEventsRequestFilters.md) |  | [optional] 
**Format** | Pointer to **string** | Response format | [optional] [default to "full"]
**Limit** | Pointer to **int32** | Max results | [optional] [default to 50]

## Methods

### NewEventSearch

`func NewEventSearch() *EventSearch`

NewEventSearch instantiates a new EventSearch object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewEventSearchWithDefaults

`func NewEventSearchWithDefaults() *EventSearch`

NewEventSearchWithDefaults instantiates a new EventSearch object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetQuery

`func (o *EventSearch) GetQuery() string`

GetQuery returns the Query field if non-nil, zero value otherwise.

### GetQueryOk

`func (o *EventSearch) GetQueryOk() (*string, bool)`

GetQueryOk returns a tuple with the Query field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetQuery

`func (o *EventSearch) SetQuery(v string)`

SetQuery sets Query field to given value.

### HasQuery

`func (o *EventSearch) HasQuery() bool`

HasQuery returns a boolean if a field has been set.

### GetFilters

`func (o *EventSearch) GetFilters() SearchEventsRequestFilters`

GetFilters returns the Filters field if non-nil, zero value otherwise.

### GetFiltersOk

`func (o *EventSearch) GetFiltersOk() (*SearchEventsRequestFilters, bool)`

GetFiltersOk returns a tuple with the Filters field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetFilters

`func (o *EventSearch) SetFilters(v SearchEventsRequestFilters)`

SetFilters sets Filters field to given value.

### HasFilters

`func (o *EventSearch) HasFilters() bool`

HasFilters returns a boolean if a field has been set.

### GetFormat

`func (o *EventSearch) GetFormat() string`

GetFormat returns the Format field if non-nil, zero value otherwise.

### GetFormatOk

`func (o *EventSearch) GetFormatOk() (*string, bool)`

GetFormatOk returns a tuple with the Format field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetFormat

`func (o *EventSearch) SetFormat(v string)`

SetFormat sets Format field to given value.

### HasFormat

`func (o *EventSearch) HasFormat() bool`

HasFormat returns a boolean if a field has been set.

### GetLimit

`func (o *EventSearch) GetLimit() int32`

GetLimit returns the Limit field if non-nil, zero value otherwise.

### GetLimitOk

`func (o *EventSearch) GetLimitOk() (*int32, bool)`

GetLimitOk returns a tuple with the Limit field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLimit

`func (o *EventSearch) SetLimit(v int32)`

SetLimit sets Limit field to given value.

### HasLimit

`func (o *EventSearch) HasLimit() bool`

HasLimit returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


