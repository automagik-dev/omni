# ListInstanceGroups200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Items** | [**[]ListInstanceGroups200ResponseItemsInner**](ListInstanceGroups200ResponseItemsInner.md) |  | 
**Meta** | [**ListInstanceContacts200ResponseMeta**](ListInstanceContacts200ResponseMeta.md) |  | 

## Methods

### NewListInstanceGroups200Response

`func NewListInstanceGroups200Response(items []ListInstanceGroups200ResponseItemsInner, meta ListInstanceContacts200ResponseMeta, ) *ListInstanceGroups200Response`

NewListInstanceGroups200Response instantiates a new ListInstanceGroups200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListInstanceGroups200ResponseWithDefaults

`func NewListInstanceGroups200ResponseWithDefaults() *ListInstanceGroups200Response`

NewListInstanceGroups200ResponseWithDefaults instantiates a new ListInstanceGroups200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetItems

`func (o *ListInstanceGroups200Response) GetItems() []ListInstanceGroups200ResponseItemsInner`

GetItems returns the Items field if non-nil, zero value otherwise.

### GetItemsOk

`func (o *ListInstanceGroups200Response) GetItemsOk() (*[]ListInstanceGroups200ResponseItemsInner, bool)`

GetItemsOk returns a tuple with the Items field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetItems

`func (o *ListInstanceGroups200Response) SetItems(v []ListInstanceGroups200ResponseItemsInner)`

SetItems sets Items field to given value.


### GetMeta

`func (o *ListInstanceGroups200Response) GetMeta() ListInstanceContacts200ResponseMeta`

GetMeta returns the Meta field if non-nil, zero value otherwise.

### GetMetaOk

`func (o *ListInstanceGroups200Response) GetMetaOk() (*ListInstanceContacts200ResponseMeta, bool)`

GetMetaOk returns a tuple with the Meta field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMeta

`func (o *ListInstanceGroups200Response) SetMeta(v ListInstanceContacts200ResponseMeta)`

SetMeta sets Meta field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


