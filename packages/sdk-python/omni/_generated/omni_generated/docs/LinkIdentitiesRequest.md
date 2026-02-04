# LinkIdentitiesRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**identity_a** | **UUID** | First identity ID | 
**identity_b** | **UUID** | Second identity ID | 

## Example

```python
from omni_generated.models.link_identities_request import LinkIdentitiesRequest

# TODO update the JSON string below
json = "{}"
# create an instance of LinkIdentitiesRequest from a JSON string
link_identities_request_instance = LinkIdentitiesRequest.from_json(json)
# print the JSON string representation of the object
print(LinkIdentitiesRequest.to_json())

# convert the object into a dict
link_identities_request_dict = link_identities_request_instance.to_dict()
# create an instance of LinkIdentitiesRequest from a dict
link_identities_request_from_dict = LinkIdentitiesRequest.from_dict(link_identities_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


