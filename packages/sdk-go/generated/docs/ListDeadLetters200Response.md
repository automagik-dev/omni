# ListDeadLetters200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Items** | [**[]ListDeadLetters200ResponseItemsInner**](ListDeadLetters200ResponseItemsInner.md) |  | 
**Meta** | [**ListInstances200ResponseMeta**](ListInstances200ResponseMeta.md) |  | 

## Methods

### NewListDeadLetters200Response

`func NewListDeadLetters200Response(items []ListDeadLetters200ResponseItemsInner, meta ListInstances200ResponseMeta, ) *ListDeadLetters200Response`

NewListDeadLetters200Response instantiates a new ListDeadLetters200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListDeadLetters200ResponseWithDefaults

`func NewListDeadLetters200ResponseWithDefaults() *ListDeadLetters200Response`

NewListDeadLetters200ResponseWithDefaults instantiates a new ListDeadLetters200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetItems

`func (o *ListDeadLetters200Response) GetItems() []ListDeadLetters200ResponseItemsInner`

GetItems returns the Items field if non-nil, zero value otherwise.

### GetItemsOk

`func (o *ListDeadLetters200Response) GetItemsOk() (*[]ListDeadLetters200ResponseItemsInner, bool)`

GetItemsOk returns a tuple with the Items field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetItems

`func (o *ListDeadLetters200Response) SetItems(v []ListDeadLetters200ResponseItemsInner)`

SetItems sets Items field to given value.


### GetMeta

`func (o *ListDeadLetters200Response) GetMeta() ListInstances200ResponseMeta`

GetMeta returns the Meta field if non-nil, zero value otherwise.

### GetMetaOk

`func (o *ListDeadLetters200Response) GetMetaOk() (*ListInstances200ResponseMeta, bool)`

GetMetaOk returns a tuple with the Meta field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMeta

`func (o *ListDeadLetters200Response) SetMeta(v ListInstances200ResponseMeta)`

SetMeta sets Meta field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


