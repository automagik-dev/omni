# SearchEvents200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Items** | [**[]ListEvents200ResponseItemsInner**](ListEvents200ResponseItemsInner.md) |  | 
**Meta** | [**ListInstances200ResponseMeta**](ListInstances200ResponseMeta.md) |  | 
**Summary** | Pointer to **string** |  | [optional] 
**AsContext** | Pointer to **string** |  | [optional] 

## Methods

### NewSearchEvents200Response

`func NewSearchEvents200Response(items []ListEvents200ResponseItemsInner, meta ListInstances200ResponseMeta, ) *SearchEvents200Response`

NewSearchEvents200Response instantiates a new SearchEvents200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSearchEvents200ResponseWithDefaults

`func NewSearchEvents200ResponseWithDefaults() *SearchEvents200Response`

NewSearchEvents200ResponseWithDefaults instantiates a new SearchEvents200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetItems

`func (o *SearchEvents200Response) GetItems() []ListEvents200ResponseItemsInner`

GetItems returns the Items field if non-nil, zero value otherwise.

### GetItemsOk

`func (o *SearchEvents200Response) GetItemsOk() (*[]ListEvents200ResponseItemsInner, bool)`

GetItemsOk returns a tuple with the Items field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetItems

`func (o *SearchEvents200Response) SetItems(v []ListEvents200ResponseItemsInner)`

SetItems sets Items field to given value.


### GetMeta

`func (o *SearchEvents200Response) GetMeta() ListInstances200ResponseMeta`

GetMeta returns the Meta field if non-nil, zero value otherwise.

### GetMetaOk

`func (o *SearchEvents200Response) GetMetaOk() (*ListInstances200ResponseMeta, bool)`

GetMetaOk returns a tuple with the Meta field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMeta

`func (o *SearchEvents200Response) SetMeta(v ListInstances200ResponseMeta)`

SetMeta sets Meta field to given value.


### GetSummary

`func (o *SearchEvents200Response) GetSummary() string`

GetSummary returns the Summary field if non-nil, zero value otherwise.

### GetSummaryOk

`func (o *SearchEvents200Response) GetSummaryOk() (*string, bool)`

GetSummaryOk returns a tuple with the Summary field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSummary

`func (o *SearchEvents200Response) SetSummary(v string)`

SetSummary sets Summary field to given value.

### HasSummary

`func (o *SearchEvents200Response) HasSummary() bool`

HasSummary returns a boolean if a field has been set.

### GetAsContext

`func (o *SearchEvents200Response) GetAsContext() string`

GetAsContext returns the AsContext field if non-nil, zero value otherwise.

### GetAsContextOk

`func (o *SearchEvents200Response) GetAsContextOk() (*string, bool)`

GetAsContextOk returns a tuple with the AsContext field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAsContext

`func (o *SearchEvents200Response) SetAsContext(v string)`

SetAsContext sets AsContext field to given value.

### HasAsContext

`func (o *SearchEvents200Response) HasAsContext() bool`

HasAsContext returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


