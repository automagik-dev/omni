# UnlinkIdentity200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**person** | [**SearchPersons200ResponseItemsInner**](SearchPersons200ResponseItemsInner.md) |  | 
**identity** | [**GetPersonPresence200ResponseDataIdentitiesInner**](GetPersonPresence200ResponseDataIdentitiesInner.md) |  | 

## Example

```python
from omni_generated.models.unlink_identity200_response_data import UnlinkIdentity200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of UnlinkIdentity200ResponseData from a JSON string
unlink_identity200_response_data_instance = UnlinkIdentity200ResponseData.from_json(json)
# print the JSON string representation of the object
print(UnlinkIdentity200ResponseData.to_json())

# convert the object into a dict
unlink_identity200_response_data_dict = unlink_identity200_response_data_instance.to_dict()
# create an instance of UnlinkIdentity200ResponseData from a dict
unlink_identity200_response_data_from_dict = UnlinkIdentity200ResponseData.from_dict(unlink_identity200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


