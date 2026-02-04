# ListEvents200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Items** | [**[]ListEvents200ResponseItemsInner**](ListEvents200ResponseItemsInner.md) |  | 
**Meta** | [**ListEvents200ResponseMeta**](ListEvents200ResponseMeta.md) |  | 

## Methods

### NewListEvents200Response

`func NewListEvents200Response(items []ListEvents200ResponseItemsInner, meta ListEvents200ResponseMeta, ) *ListEvents200Response`

NewListEvents200Response instantiates a new ListEvents200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListEvents200ResponseWithDefaults

`func NewListEvents200ResponseWithDefaults() *ListEvents200Response`

NewListEvents200ResponseWithDefaults instantiates a new ListEvents200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetItems

`func (o *ListEvents200Response) GetItems() []ListEvents200ResponseItemsInner`

GetItems returns the Items field if non-nil, zero value otherwise.

### GetItemsOk

`func (o *ListEvents200Response) GetItemsOk() (*[]ListEvents200ResponseItemsInner, bool)`

GetItemsOk returns a tuple with the Items field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetItems

`func (o *ListEvents200Response) SetItems(v []ListEvents200ResponseItemsInner)`

SetItems sets Items field to given value.


### GetMeta

`func (o *ListEvents200Response) GetMeta() ListEvents200ResponseMeta`

GetMeta returns the Meta field if non-nil, zero value otherwise.

### GetMetaOk

`func (o *ListEvents200Response) GetMetaOk() (*ListEvents200ResponseMeta, bool)`

GetMetaOk returns a tuple with the Meta field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMeta

`func (o *ListEvents200Response) SetMeta(v ListEvents200ResponseMeta)`

SetMeta sets Meta field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


