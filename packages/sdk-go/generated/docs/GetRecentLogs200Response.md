# GetRecentLogs200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Items** | [**[]GetRecentLogs200ResponseItemsInner**](GetRecentLogs200ResponseItemsInner.md) |  | 
**Meta** | [**GetRecentLogs200ResponseMeta**](GetRecentLogs200ResponseMeta.md) |  | 

## Methods

### NewGetRecentLogs200Response

`func NewGetRecentLogs200Response(items []GetRecentLogs200ResponseItemsInner, meta GetRecentLogs200ResponseMeta, ) *GetRecentLogs200Response`

NewGetRecentLogs200Response instantiates a new GetRecentLogs200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetRecentLogs200ResponseWithDefaults

`func NewGetRecentLogs200ResponseWithDefaults() *GetRecentLogs200Response`

NewGetRecentLogs200ResponseWithDefaults instantiates a new GetRecentLogs200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetItems

`func (o *GetRecentLogs200Response) GetItems() []GetRecentLogs200ResponseItemsInner`

GetItems returns the Items field if non-nil, zero value otherwise.

### GetItemsOk

`func (o *GetRecentLogs200Response) GetItemsOk() (*[]GetRecentLogs200ResponseItemsInner, bool)`

GetItemsOk returns a tuple with the Items field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetItems

`func (o *GetRecentLogs200Response) SetItems(v []GetRecentLogs200ResponseItemsInner)`

SetItems sets Items field to given value.


### GetMeta

`func (o *GetRecentLogs200Response) GetMeta() GetRecentLogs200ResponseMeta`

GetMeta returns the Meta field if non-nil, zero value otherwise.

### GetMetaOk

`func (o *GetRecentLogs200Response) GetMetaOk() (*GetRecentLogs200ResponseMeta, bool)`

GetMetaOk returns a tuple with the Meta field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMeta

`func (o *GetRecentLogs200Response) SetMeta(v GetRecentLogs200ResponseMeta)`

SetMeta sets Meta field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


