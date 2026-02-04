# ListInstances200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Items** | [**[]ListInstances200ResponseItemsInner**](ListInstances200ResponseItemsInner.md) |  | 
**Meta** | [**ListInstances200ResponseMeta**](ListInstances200ResponseMeta.md) |  | 

## Methods

### NewListInstances200Response

`func NewListInstances200Response(items []ListInstances200ResponseItemsInner, meta ListInstances200ResponseMeta, ) *ListInstances200Response`

NewListInstances200Response instantiates a new ListInstances200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListInstances200ResponseWithDefaults

`func NewListInstances200ResponseWithDefaults() *ListInstances200Response`

NewListInstances200ResponseWithDefaults instantiates a new ListInstances200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetItems

`func (o *ListInstances200Response) GetItems() []ListInstances200ResponseItemsInner`

GetItems returns the Items field if non-nil, zero value otherwise.

### GetItemsOk

`func (o *ListInstances200Response) GetItemsOk() (*[]ListInstances200ResponseItemsInner, bool)`

GetItemsOk returns a tuple with the Items field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetItems

`func (o *ListInstances200Response) SetItems(v []ListInstances200ResponseItemsInner)`

SetItems sets Items field to given value.


### GetMeta

`func (o *ListInstances200Response) GetMeta() ListInstances200ResponseMeta`

GetMeta returns the Meta field if non-nil, zero value otherwise.

### GetMetaOk

`func (o *ListInstances200Response) GetMetaOk() (*ListInstances200ResponseMeta, bool)`

GetMetaOk returns a tuple with the Meta field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMeta

`func (o *ListInstances200Response) SetMeta(v ListInstances200ResponseMeta)`

SetMeta sets Meta field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


